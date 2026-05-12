import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const siteDir = path.resolve(process.env.SITE_DIR || path.join(projectRoot, "dist"));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectRoot, "server-data"));
const submissionsFile = path.join(dataDir, "submissions.jsonl");
const catalogPatchFile = path.join(dataDir, "catalog-patch.json");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8080);
const adminToken = process.env.ADMIN_TOKEN || "";
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 5 * 1024 * 1024);
const maxSubmissionAttachments = Number(process.env.MAX_SUBMISSION_ATTACHMENTS || 3);
const maxAttachmentDataUrlBytes = Number(process.env.MAX_ATTACHMENT_DATA_URL_BYTES || 1024 * 1024);
const postRateWindowMs = Number(process.env.POST_RATE_WINDOW_MS || 10 * 60 * 1000);
const postRateLimit = Number(process.env.POST_RATE_LIMIT || 20);
const postRateBuckets = new Map();

const textFields = [
  "id",
  "kind",
  "campus",
  "channel",
  "vendorId",
  "vendorName",
  "itemId",
  "itemName",
  "area",
  "floor",
  "windowNo",
  "suggestedDish",
  "suggestedTags",
  "note",
  "contact",
  "createdAt",
  "status",
];

const allowedKinds = new Set(["correction", "new-vendor", "new-dish", "outdated", "closed"]);
const allowedCampus = new Set(["south", "north"]);
const allowedChannels = new Set(["canteen", "delivery", "nearby"]);
const allowedSubmissionStatuses = new Set(["pending", "reviewed", "applied", "rejected"]);

await mkdir(dataDir, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    if (statusCode >= 500) {
      console.error("[site-server] request failed", error);
    }
    sendJson(response, statusCode, { ok: false, error: error?.message || "internal_server_error" });
  }
});

server.listen(port, host, () => {
  console.log(`[site-server] listening on http://${host}:${port}`);
  console.log(`[site-server] serving ${siteDir}`);
  console.log(`[site-server] storing submissions in ${submissionsFile}`);
});

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    const submissions = await readSubmissions();
    const patch = await readCatalogPatch();
    sendJson(response, 200, {
      ok: true,
      service: "xdu-food-oracle",
      submissions: submissions.length,
      catalogPatchUpdatedAt: patch.updatedAt || null,
      publicMode: !adminToken,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/submissions" && request.method === "GET") {
    const includePrivate = isAdmin(request);
    const submissions = (await readSubmissions()).map((entry) =>
      includePrivate ? entry : redactPrivateFields(entry),
    );
    sendJson(response, 200, { ok: true, submissions });
    return;
  }

  if (url.pathname === "/api/catalog-patch" && request.method === "GET") {
    sendJson(response, 200, { ok: true, patch: await readCatalogPatch() });
    return;
  }

  if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
    if (!isAdmin(request)) {
      sendJson(response, 401, { ok: false, error: "admin_token_required" });
      return;
    }
    sendJson(response, 200, { ok: true, submissions: await readSubmissions() });
    return;
  }

  if (url.pathname.startsWith("/api/admin/submissions/") && request.method === "PATCH") {
    if (!isAdmin(request)) {
      sendJson(response, 401, { ok: false, error: "admin_token_required" });
      return;
    }
    const id = decodeURIComponent(url.pathname.slice("/api/admin/submissions/".length));
    const body = await readJsonBody(request);
    const status = typeof body.status === "string" && allowedSubmissionStatuses.has(body.status)
      ? body.status
      : "";
    if (!id || !status) {
      sendJson(response, 400, { ok: false, error: "invalid_submission_status" });
      return;
    }
    const submissions = await updateSubmission(id, { status });
    sendJson(response, 200, { ok: true, submissions });
    return;
  }

  if (url.pathname === "/api/admin/catalog-patch" && request.method === "PUT") {
    if (!isAdmin(request)) {
      sendJson(response, 401, { ok: false, error: "admin_token_required" });
      return;
    }
    const body = await readJsonBody(request);
    const patch = normalizeCatalogPatch(body);
    await writeCatalogPatch(patch);
    sendJson(response, 200, { ok: true, patch });
    return;
  }

  if (url.pathname === "/api/submissions" && request.method === "POST") {
    if (!checkPostRateLimit(request)) {
      sendJson(response, 429, { ok: false, error: "rate_limited" });
      return;
    }
    const body = await readJsonBody(request);
    const submission = normalizeSubmission(body);
    await appendFile(submissionsFile, `${JSON.stringify(submission)}\n`, "utf8");
    sendJson(response, 201, { ok: true, submission: redactPrivateFields(submission) });
    return;
  }

  if (url.pathname === "/api/submissions" && request.method === "DELETE") {
    if (!isAdmin(request)) {
      sendJson(response, 401, { ok: false, error: "admin_token_required" });
      return;
    }
    const backupPath = path.join(dataDir, `submissions-${Date.now()}.jsonl.bak`);
    try {
      const existing = await readFile(submissionsFile);
      await writeFile(backupPath, existing);
    } catch {
      // No submissions yet.
    }
    await writeFile(submissionsFile, "");
    sendJson(response, 200, { ok: true, backup: path.basename(backupPath) });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: "not_found" });
    return;
  }

  await serveStatic(url.pathname, response);
}

function checkPostRateLimit(request) {
  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = postRateBuckets.get(address);
  if (!bucket || now - bucket.startedAt > postRateWindowMs) {
    postRateBuckets.set(address, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= postRateLimit;
}

async function serveStatic(pathname, response) {
  const decodedPath = decodeURIComponent(pathname);
  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.resolve(siteDir, `.${normalized}`);

  if (!requestedPath.startsWith(siteDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let filePath = requestedPath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(siteDir, "index.html");
  }

  try {
    const info = await stat(filePath);
    const headers = {
      "Content-Type": contentType(filePath),
      "Content-Length": String(info.size),
      "Cache-Control": cacheControl(filePath),
      ETag: weakEtag(`${filePath}:${info.size}:${info.mtimeMs}`),
    };
    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readSubmissions() {
  try {
    const raw = await readFile(submissionsFile, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

async function updateSubmission(id, patch) {
  const submissions = await readSubmissions();
  const next = submissions.map((entry) =>
    entry.id === id ? { ...entry, ...patch, reviewedAt: new Date().toISOString() } : entry,
  );
  await writeFile(submissionsFile, next.map((entry) => JSON.stringify(entry)).join("\n") + (next.length ? "\n" : ""), "utf8");
  return next;
}

async function readCatalogPatch() {
  try {
    return normalizeCatalogPatch(JSON.parse(await readFile(catalogPatchFile, "utf8")));
  } catch {
    return normalizeCatalogPatch({});
  }
}

async function writeCatalogPatch(patch) {
  patch.updatedAt = new Date().toISOString();
  try {
    const existing = await readFile(catalogPatchFile);
    await writeFile(path.join(dataDir, `catalog-patch-${Date.now()}.json.bak`), existing);
  } catch {
    // First write.
  }
  await writeFile(catalogPatchFile, JSON.stringify(patch, null, 2), "utf8");
}

function normalizeCatalogPatch(value) {
  const patch = value && typeof value === "object" ? value : {};
  return {
    vendorOverrides: plainRecord(patch.vendorOverrides),
    itemOverrides: plainRecord(patch.itemOverrides),
    addedVendors: Array.isArray(patch.addedVendors) ? patch.addedVendors.slice(0, 300) : [],
    addedItems: normalizeAddedItems(patch.addedItems),
    hiddenVendorIds: stringArray(patch.hiddenVendorIds),
    hiddenItemIds: stringArray(patch.hiddenItemIds),
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : undefined,
  };
}

function normalizeAddedItems(value) {
  const record = plainRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, items]) => [key.slice(0, 160), Array.isArray(items) ? items.slice(0, 300) : []]),
  );
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [String(key).slice(0, 200), entry && typeof entry === "object" ? entry : {}]),
  );
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string").map((entry) => entry.slice(0, 200)) : [];
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("request_entity_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeSubmission(input) {
  if (!input || typeof input !== "object") {
    throw httpError(400, "invalid_submission");
  }

  const value = {};
  for (const field of textFields) {
    if (typeof input[field] === "string") {
      value[field] = input[field].trim().slice(0, field === "note" ? 1200 : 160);
    }
  }

  value.id = randomUUID();
  value.kind = allowedKinds.has(value.kind) ? value.kind : "correction";
  value.campus = allowedCampus.has(value.campus) ? value.campus : "south";
  value.channel = allowedChannels.has(value.channel) ? value.channel : "canteen";
  value.supportedChannels = normalizeSupportedChannels(input.supportedChannels, value.channel);
  value.status = "pending";
  value.createdAt = new Date().toISOString();
  value.suggestedPrice = parseOptionalPrice(input.suggestedPrice);
  value.attachments = normalizeSubmissionAttachments(input.attachments);
  value.attachmentCount = value.attachments.length;

  if (!value.vendorName || !value.area) {
    throw httpError(400, "vendor_name_and_area_required");
  }
  if (value.kind !== "new-vendor" && !value.note) {
    throw httpError(400, "note_required_for_corrections");
  }

  return value;
}

function normalizeSubmissionAttachments(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, maxSubmissionAttachments)
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null;
      const dataUrl = typeof attachment.dataUrl === "string" ? attachment.dataUrl.trim() : "";
      const mimeType = typeof attachment.mimeType === "string" ? attachment.mimeType.trim().toLowerCase() : "";
      if (!/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)) return null;
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return null;
      if (Buffer.byteLength(dataUrl, "utf8") > maxAttachmentDataUrlBytes) return null;
      return {
        id: typeof attachment.id === "string" ? attachment.id.trim().slice(0, 80) : randomUUID(),
        name: typeof attachment.name === "string" ? attachment.name.trim().slice(0, 120) : "menu-photo.jpg",
        mimeType,
        size: parseAttachmentSize(attachment.size, dataUrl),
        dataUrl,
      };
    })
    .filter(Boolean);
}

function parseAttachmentSize(input, dataUrl) {
  const value = Number(input);
  if (Number.isFinite(value) && value > 0 && value <= maxAttachmentDataUrlBytes) {
    return Math.round(value);
  }
  return Buffer.byteLength(dataUrl, "utf8");
}

function normalizeSupportedChannels(input, primaryChannel) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,，、\s]+/)
      : [];
  const channels = raw
    .map((entry) => String(entry).trim())
    .filter((entry) => allowedChannels.has(entry));
  return Array.from(new Set([primaryChannel, ...channels]));
}

function parseOptionalPrice(price) {
  if (price === undefined || price === null || price === "") return undefined;
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0 || value > 999) return undefined;
  return Math.round(value * 100) / 100;
}

function redactPrivateFields(entry) {
  const { contact, attachments, ...publicEntry } = entry;
  return {
    ...publicEntry,
    attachmentCount: Number(publicEntry.attachmentCount || attachments?.length || 0),
  };
}

function isAdmin(request) {
  if (!adminToken) return false;
  return request.headers["x-admin-token"] === adminToken;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json;charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html;charset=utf-8",
      ".js": "text/javascript;charset=utf-8",
      ".css": "text/css;charset=utf-8",
      ".json": "application/json;charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".webp": "image/webp",
    }[ext] || "application/octet-stream"
  );
}

function cacheControl(filePath) {
  return filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function weakEtag(value) {
  return `W/"${createHash("sha1").update(value).digest("hex").slice(0, 16)}"`;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
