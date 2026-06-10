import { createRequire } from "node:module";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
const legacyImportKey = "legacy_json_import_v1";

export async function createSqliteStore({
  dataDir,
  databaseFile,
  legacySubmissionsFile,
  legacyCatalogPatchFile,
  logger = console,
  now = () => new Date().toISOString(),
}) {
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.dirname(databaseFile), { recursive: true });
  const SQL = await initSqlJs({
    locateFile(fileName) {
      if (fileName === "sql-wasm.wasm") {
        return require.resolve("sql.js/dist/sql-wasm.wasm");
      }
      return fileName;
    },
  });

  let db;
  try {
    db = new SQL.Database(new Uint8Array(await readFile(databaseFile)));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    db = new SQL.Database();
  }

  const store = new SqliteStore({
    db,
    dataDir,
    databaseFile,
    legacySubmissionsFile,
    legacyCatalogPatchFile,
    logger,
    now,
  });
  store.initialize();
  await store.importLegacyFilesOnce();
  await store.persist();
  return store;
}

export class SqliteStore {
  constructor({ db, dataDir, databaseFile, legacySubmissionsFile, legacyCatalogPatchFile, logger, now }) {
    this.db = db;
    this.dataDir = dataDir;
    this.databaseFile = databaseFile;
    this.legacySubmissionsFile = legacySubmissionsFile;
    this.legacyCatalogPatchFile = legacyCatalogPatchFile;
    this.logger = logger;
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  initialize() {
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        campus TEXT NOT NULL,
        channel TEXT NOT NULL,
        vendor_name TEXT NOT NULL,
        area TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        contact TEXT,
        attachment_count INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_submissions_status_created
        ON submissions(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_vendor
        ON submissions(vendor_name, area);

      CREATE TABLE IF NOT EXISTS submission_attachments (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        data_blob BLOB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_submission_attachments_submission
        ON submission_attachments(submission_id);

      CREATE TABLE IF NOT EXISTS catalog_patch (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        updated_at TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  info() {
    return {
      kind: "sqlite",
      databaseFile: this.databaseFile,
    };
  }

  readSubmissions() {
    return this.query("SELECT payload_json FROM submissions ORDER BY created_at DESC, id DESC").map((row) =>
      this.hydrateSubmission(JSON.parse(row.payload_json)),
    );
  }

  async addSubmission(submission) {
    this.upsertSubmission(submission, { recordChange: true });
    await this.persist();
    return this.hydrateSubmission(stripAttachments(submission));
  }

  async updateSubmission(id, patch) {
    const existing = this.readSubmission(id);
    if (!existing) return this.readSubmissions();
    const next = { ...existing, ...patch, reviewedAt: this.now() };
    this.upsertSubmission(next, { recordChange: true });
    await this.persist();
    return this.readSubmissions();
  }

  async clearSubmissions() {
    const submissions = this.readSubmissions();
    const backupName = `submissions-${Date.now()}.jsonl.bak`;
    if (submissions.length) {
      const backupPath = path.join(this.dataDir, backupName);
      await writeFile(backupPath, submissions.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
    }
    this.db.run("DELETE FROM submission_attachments");
    this.db.run("DELETE FROM submissions");
    this.recordChange("submission", null, "clear", { count: submissions.length, backup: submissions.length ? backupName : null });
    await this.persist();
    return submissions.length ? backupName : null;
  }

  readCatalogPatch() {
    const rows = this.query("SELECT payload_json FROM catalog_patch WHERE id = 1");
    if (!rows.length) return {};
    return JSON.parse(rows[0].payload_json);
  }

  async writeCatalogPatch(patch) {
    const existing = this.readCatalogPatch();
    const existingHasData = Object.keys(existing).length > 0;
    if (existingHasData) {
      await writeFile(
        path.join(this.dataDir, `catalog-patch-${Date.now()}.json.bak`),
        JSON.stringify(existing, null, 2),
        "utf8",
      );
    }

    const next = { ...patch, updatedAt: this.now() };
    this.writeCatalogPatchInternal(next, { recordChange: true });
    await this.persist();
    return next;
  }

  async importLegacyFilesOnce() {
    if (this.getMetadata(legacyImportKey)) return;

    let importedSubmissions = 0;
    if (this.countRows("submissions") === 0) {
      importedSubmissions = await this.importLegacySubmissions();
    }

    let importedPatch = false;
    if (!this.query("SELECT id FROM catalog_patch WHERE id = 1").length) {
      importedPatch = await this.importLegacyCatalogPatch();
    }

    this.setMetadata(legacyImportKey, JSON.stringify({
      importedAt: this.now(),
      importedSubmissions,
      importedCatalogPatch: importedPatch,
    }));

    if (importedSubmissions || importedPatch) {
      this.logger.info?.(
        `[site-server] imported legacy data into SQLite: ${importedSubmissions} submissions, catalog patch: ${importedPatch ? "yes" : "no"}`,
      );
    }
  }

  async importLegacySubmissions() {
    let raw = "";
    try {
      raw = await readFile(this.legacySubmissionsFile, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger.warn?.(`[site-server] could not import ${this.legacySubmissionsFile}: ${error?.message || error}`);
      }
      return 0;
    }

    let count = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        this.upsertSubmission(JSON.parse(line), { recordChange: false });
        count += 1;
      } catch (error) {
        this.logger.warn?.(`[site-server] skipped malformed legacy submission: ${error?.message || error}`);
      }
    }
    return count;
  }

  async importLegacyCatalogPatch() {
    try {
      const patch = JSON.parse(await readFile(this.legacyCatalogPatchFile, "utf8"));
      this.writeCatalogPatchInternal(patch, { recordChange: false });
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger.warn?.(`[site-server] could not import ${this.legacyCatalogPatchFile}: ${error?.message || error}`);
      }
      return false;
    }
  }

  readSubmission(id) {
    const rows = this.query("SELECT payload_json FROM submissions WHERE id = ?", [id]);
    if (!rows.length) return null;
    return this.hydrateSubmission(JSON.parse(rows[0].payload_json));
  }

  upsertSubmission(submission, { recordChange }) {
    const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
    const storableAttachments = attachments
      .map((attachment, index) => ({ attachment, index, parsed: parseDataUrl(attachment?.dataUrl) }))
      .filter((entry) => entry.parsed);
    const payload = stripAttachments({
      ...submission,
      attachmentCount: storableAttachments.length,
    });

    this.run(
      `INSERT INTO submissions (
        id, kind, campus, channel, vendor_name, area, status, created_at,
        reviewed_at, contact, attachment_count, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        campus = excluded.campus,
        channel = excluded.channel,
        vendor_name = excluded.vendor_name,
        area = excluded.area,
        status = excluded.status,
        created_at = excluded.created_at,
        reviewed_at = excluded.reviewed_at,
        contact = excluded.contact,
        attachment_count = excluded.attachment_count,
        payload_json = excluded.payload_json`,
      [
        payload.id,
        payload.kind || "correction",
        payload.campus || "south",
        payload.channel || "canteen",
        payload.vendorName || "",
        payload.area || "",
        payload.status || "pending",
        payload.createdAt || this.now(),
        payload.reviewedAt || null,
        payload.contact || null,
        Number(payload.attachmentCount || 0),
        JSON.stringify(payload),
      ],
    );

    this.run("DELETE FROM submission_attachments WHERE submission_id = ?", [payload.id]);
    for (const { attachment, index, parsed } of storableAttachments) {
      this.run(
        `INSERT INTO submission_attachments (
          id, submission_id, name, mime_type, size_bytes, data_blob, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          attachment.id || `${payload.id}-photo-${index + 1}`,
          payload.id,
          attachment.name || "menu-photo.jpg",
          attachment.mimeType || parsed.mimeType,
          Number(attachment.size || parsed.bytes.byteLength || 0),
          parsed.bytes,
          payload.createdAt || this.now(),
        ],
      );
    }

    if (recordChange) {
      this.recordChange("submission", payload.id, "upsert", payload);
    }
  }

  hydrateSubmission(payload) {
    const attachments = this.readAttachments(payload.id);
    return {
      ...payload,
      attachments,
      attachmentCount: attachments.length,
    };
  }

  readAttachments(submissionId) {
    return this.query(
      `SELECT id, name, mime_type, size_bytes, data_blob
       FROM submission_attachments
       WHERE submission_id = ?
       ORDER BY rowid ASC`,
      [submissionId],
    ).map((row) => ({
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      size: Number(row.size_bytes || 0),
      dataUrl: `data:${row.mime_type};base64,${Buffer.from(row.data_blob).toString("base64")}`,
    }));
  }

  writeCatalogPatchInternal(patch, { recordChange }) {
    const updatedAt = typeof patch.updatedAt === "string" ? patch.updatedAt : this.now();
    this.run(
      `INSERT INTO catalog_patch (id, updated_at, payload_json)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         payload_json = excluded.payload_json`,
      [updatedAt, JSON.stringify({ ...patch, updatedAt })],
    );
    if (recordChange) {
      this.recordChange("catalog_patch", "1", "replace", { updatedAt });
    }
  }

  recordChange(entityType, entityId, action, payload) {
    this.run(
      `INSERT INTO change_log (entity_type, entity_id, action, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [entityType, entityId, action, this.now(), JSON.stringify(payload ?? {})],
    );
  }

  getMetadata(key) {
    const rows = this.query("SELECT value FROM metadata WHERE key = ?", [key]);
    return rows.length ? rows[0].value : "";
  }

  setMetadata(key, value) {
    this.run(
      `INSERT INTO metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  countRows(tableName) {
    const rows = this.query(`SELECT COUNT(*) AS count FROM ${tableName}`);
    return Number(rows[0]?.count || 0);
  }

  query(sql, params = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  run(sql, params = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
  }

  async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const tempFile = `${this.databaseFile}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempFile, Buffer.from(this.db.export()));
      await rename(tempFile, this.databaseFile);
    });
    return this.writeQueue;
  }

  close() {
    this.db.close();
  }
}

function stripAttachments(submission) {
  const { attachments, ...payload } = submission;
  return payload;
}

function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    bytes: new Uint8Array(Buffer.from(match[2].replace(/\s+/g, ""), "base64")),
  };
}
