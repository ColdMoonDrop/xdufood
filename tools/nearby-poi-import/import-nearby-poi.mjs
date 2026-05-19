import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const defaultOutputDir = path.join(repoRoot, "data", "nearby-poi");
const fetchedAt = new Date().toISOString();

const args = new Set(process.argv.slice(2));
const probeOnly = args.has("--probe");
const outputDir = getArgValue("--output", defaultOutputDir);
const locationsPath = getArgValue("--locations", path.join(__dirname, "locations.json"));
const manualSeedsPath = getArgValue("--manual-seeds", path.join(__dirname, "manual-public-seeds.json"));

const keywords = ["餐饮", "小吃", "奶茶", "咖啡", "快餐", "烧烤", "面", "米饭"];
const ignoredPoiNames = new Set(["海棠餐厅", "丁香餐厅", "竹园餐厅", "西区餐厅", "东区餐厅", "西军电餐厅"]);
const amapKey = process.env.AMAP_WEB_SERVICE_KEY || process.env.GAODE_WEB_SERVICE_KEY || "";
const baiduAk = process.env.BAIDU_MAP_AK || process.env.BAIDU_LBS_AK || "";

const locations = await readJson(locationsPath);
const manualSeeds = await readJson(manualSeedsPath);
const report = {
  fetchedAt,
  probeOnly,
  outputDir,
  sources: [],
  notes: [],
};

const records = [];

records.push(...normalizeManualSeeds(manualSeeds));
records.push(...await queryOpenStreetMap(locations));
records.push(...await queryAmap(locations, keywords, amapKey));
records.push(...await queryBaidu(locations, keywords, baiduAk));

const deduped = dedupe(records);
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "nearby-poi-candidates.json"), JSON.stringify(deduped, null, 2), "utf8");
await writeFile(path.join(outputDir, "nearby-poi-candidates.csv"), toCsv(deduped), "utf8");
await writeFile(path.join(outputDir, "nearby-poi-report.json"), JSON.stringify(report, null, 2), "utf8");

console.log([
  `Nearby POI import finished at ${fetchedAt}`,
  `Candidates: ${deduped.length}`,
  `Output: ${path.relative(repoRoot, outputDir)}`,
  ...report.sources.map((source) => `${source.name}: ${source.status}${source.count === undefined ? "" : ` (${source.count})`}${source.message ? ` - ${source.message}` : ""}`),
].join("\n"));

function getArgValue(name, fallback) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function normalizeManualSeeds(seeds) {
  report.sources.push({
    name: "manual-public-seeds",
    status: "ok",
    count: seeds.length,
    message: "Public student guides only; all records remain pending review.",
  });

  return seeds.map((seed, index) => ({
    id: stableId("manual", seed.area, seed.name, index),
    platform: "public-web",
    source: "公开学生资料",
    sourceMethod: "public-text",
    sourceUrl: seed.sourceUrl,
    sourceTitle: seed.sourceTitle,
    campus: "south",
    area: seed.area,
    name: seed.name,
    category: seed.category || "",
    address: "",
    telephone: "",
    floor: seed.floor || "",
    locationHint: seed.locationHint || seed.area,
    latitude: "",
    longitude: "",
    confidence: "low",
    reviewStatus: "pending",
    menuStatus: "missing",
    supportsDelivery: "unknown",
    fetchedAt,
    note: seed.note || "Needs student/admin review.",
  }));
}

async function queryOpenStreetMap(locations) {
  const results = [];
  let failures = 0;

  for (const location of locations) {
    const query = `[out:json][timeout:25];(` +
      `node(around:${location.radiusMeters},${location.latitude},${location.longitude})[amenity~"restaurant|fast_food|cafe"];` +
      `way(around:${location.radiusMeters},${location.latitude},${location.longitude})[amenity~"restaurant|fast_food|cafe"];` +
      `node(around:${location.radiusMeters},${location.latitude},${location.longitude})[shop~"convenience|bakery|beverages"];` +
      `way(around:${location.radiusMeters},${location.latitude},${location.longitude})[shop~"convenience|bakery|beverages"];` +
      `);out center tags 100;`;
    const body = new URLSearchParams({ data: query });

    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "xdu-food-oracle" },
        body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      for (const element of payload.elements || []) {
        const tags = element.tags || {};
        if (!tags.name) continue;
        if (ignoredPoiNames.has(tags.name)) continue;
        results.push({
          id: stableId("osm", element.type, element.id),
          platform: "openstreetmap",
          source: "OpenStreetMap Overpass",
          sourceMethod: "poi-api",
          sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
          sourceTitle: "OpenStreetMap",
          campus: location.campus,
          area: location.area,
          name: tags.name,
          category: tags.amenity || tags.shop || "",
          address: "",
          telephone: tags.phone || tags["contact:phone"] || "",
          floor: "",
          locationHint: location.name,
          latitude: String(element.lat ?? element.center?.lat ?? ""),
          longitude: String(element.lon ?? element.center?.lon ?? ""),
          confidence: tags.name.includes("餐厅") ? "medium" : "low",
          reviewStatus: "pending",
          menuStatus: "missing",
          supportsDelivery: "unknown",
          fetchedAt,
          note: "OpenStreetMap has location-level POI only; menu and current tenant need review.",
        });
      }
    } catch (error) {
      failures += 1;
      report.notes.push(`OpenStreetMap failed for ${location.area}: ${error.message}`);
    }
  }

  report.sources.push({
    name: "openstreetmap-overpass",
    status: failures ? "partial" : "ok",
    count: results.length,
    message: failures ? `${failures} location queries failed` : "No API key required; coverage inside buildings is limited.",
  });

  return results;
}

async function queryAmap(locations, keywords, key) {
  if (!key) {
    report.sources.push({
      name: "amap-web-service",
      status: "skipped",
      message: "Set AMAP_WEB_SERVICE_KEY or GAODE_WEB_SERVICE_KEY to query 高德 POI.",
    });
    return [];
  }

  const results = [];
  for (const location of locations) {
    for (const keyword of keywords) {
      const url = new URL("https://restapi.amap.com/v3/place/around");
      url.search = new URLSearchParams({
        key,
        location: `${location.longitude},${location.latitude}`,
        keywords: keyword,
        types: "050000",
        radius: String(location.radiusMeters),
        offset: "25",
        page: "1",
        extensions: "base",
        output: "json",
      });
      const payload = await fetchJson(url);
      if (payload.status !== "1") {
        report.sources.push({ name: "amap-web-service", status: "error", message: `${payload.info || "unknown"} ${payload.infocode || ""}`.trim() });
        return results;
      }
      for (const poi of payload.pois || []) {
        if (ignoredPoiNames.has(poi.name)) continue;
        const [longitude = "", latitude = ""] = String(poi.location || "").split(",");
        results.push({
          id: stableId("amap", poi.id || poi.name, location.area),
          platform: "amap",
          source: "高德地图 Web 服务 POI",
          sourceMethod: "poi-api",
          sourceUrl: "https://lbs.amap.com/api/webservice/guide/api/search",
          sourceTitle: "高德地图 Web服务 API 搜索 POI",
          campus: location.campus,
          area: location.area,
          name: poi.name || "",
          category: poi.type || "",
          address: flatten(poi.address),
          telephone: flatten(poi.tel),
          floor: "",
          locationHint: location.name,
          latitude,
          longitude,
          confidence: "medium",
          reviewStatus: "pending",
          menuStatus: "missing",
          supportsDelivery: "unknown",
          fetchedAt,
          note: "POI only; menu and whether it serves students need review.",
        });
      }
    }
  }

  report.sources.push({ name: "amap-web-service", status: "ok", count: results.length });
  return results;
}

async function queryBaidu(locations, keywords, ak) {
  if (!ak) {
    report.sources.push({
      name: "baidu-place-api",
      status: "skipped",
      message: "Set BAIDU_MAP_AK or BAIDU_LBS_AK to query 百度 Place API.",
    });
    return [];
  }

  const results = [];
  for (const location of locations) {
    for (const keyword of keywords) {
      const url = new URL("https://api.map.baidu.com/place/v2/search");
      url.search = new URLSearchParams({
        ak,
        query: keyword,
        tag: "美食",
        location: `${location.latitude},${location.longitude}`,
        radius: String(location.radiusMeters),
        output: "json",
        scope: "2",
        page_size: "20",
        page_num: "0",
      });
      const payload = await fetchJson(url);
      if (payload.status !== 0) {
        report.sources.push({ name: "baidu-place-api", status: "error", message: payload.message || `status ${payload.status}` });
        return results;
      }
      for (const poi of payload.results || []) {
        if (ignoredPoiNames.has(poi.name)) continue;
        results.push({
          id: stableId("baidu", poi.uid || poi.name, location.area),
          platform: "baidu",
          source: "百度地图 Place API",
          sourceMethod: "poi-api",
          sourceUrl: "https://api.map.baidu.com/lbsapi/cloud/webservice-placeapi.htm",
          sourceTitle: "百度地图 Place API",
          campus: location.campus,
          area: location.area,
          name: poi.name || "",
          category: poi.detail_info?.tag || "",
          address: poi.address || "",
          telephone: poi.telephone || "",
          floor: "",
          locationHint: location.name,
          latitude: String(poi.location?.lat || ""),
          longitude: String(poi.location?.lng || ""),
          confidence: "medium",
          reviewStatus: "pending",
          menuStatus: "missing",
          supportsDelivery: "unknown",
          fetchedAt,
          note: "Baidu coordinates are BD-09; convert before drawing maps. Menu still needs review.",
        });
      }
    }
  }

  report.sources.push({ name: "baidu-place-api", status: "ok", count: results.length });
  return results;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.hostname}`);
  return response.json();
}

function dedupe(records) {
  const byKey = new Map();
  for (const record of records.filter((entry) => entry.name)) {
    const key = [record.area, normalizeText(record.name)].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...record, duplicateCount: 1, duplicateSources: [record.platform] });
      continue;
    }
    existing.duplicateCount += 1;
    existing.duplicateSources = Array.from(new Set([...existing.duplicateSources, record.platform]));
    existing.sourceUrl = existing.sourceUrl || record.sourceUrl;
    existing.address = existing.address || record.address;
    existing.telephone = existing.telephone || record.telephone;
    existing.latitude = existing.latitude || record.latitude;
    existing.longitude = existing.longitude || record.longitude;
    existing.note = `${existing.note || ""}${existing.note ? " " : ""}Duplicate source: ${record.platform}.`.trim();
  }
  return [...byKey.values()].sort((a, b) => a.area.localeCompare(b.area, "zh-Hans-CN") || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function toCsv(records) {
  const headers = [
    "id",
    "area",
    "name",
    "platform",
    "category",
    "floor",
    "locationHint",
    "address",
    "telephone",
    "latitude",
    "longitude",
    "confidence",
    "reviewStatus",
    "menuStatus",
    "supportsDelivery",
    "sourceUrl",
    "note",
  ];
  return [
    headers.join(","),
    ...records.map((record) => headers.map((header) => csvCell(record[header] ?? "")).join(",")),
  ].join("\n");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(";") : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function stableId(...parts) {
  return normalizeText(parts.filter(Boolean).join("-"))
    .replace(/[^\p{Script=Han}a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || `poi-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeText(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()·•.,，。:：;；/\\-]+/g, "");
}

function flatten(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(";") : String(value || "");
}
