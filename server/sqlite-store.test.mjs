import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteStore } from "./sqlite-store.mjs";

const fixedNow = "2026-06-10T00:00:00.000Z";
const sampleImage = "data:image/png;base64,aGVsbG8=";
const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("sqlite store", () => {
  it("imports legacy JSON files into a SQLite database", async () => {
    const dataDir = await makeTempDir();
    const legacySubmissionsFile = path.join(dataDir, "submissions.jsonl");
    const legacyCatalogPatchFile = path.join(dataDir, "catalog-patch.json");
    const databaseFile = path.join(dataDir, "xdufood.sqlite");

    await writeFile(
      legacySubmissionsFile,
      `${JSON.stringify({
        id: "legacy-1",
        kind: "correction",
        campus: "south",
        channel: "canteen",
        vendorName: "竹园二楼12号",
        area: "竹园二层餐厅",
        note: "档口改成烤肉饭",
        status: "pending",
        createdAt: "2026-06-09T12:00:00.000Z",
        attachments: [
          {
            id: "photo-1",
            name: "menu.png",
            mimeType: "image/png",
            size: 5,
            dataUrl: sampleImage,
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      legacyCatalogPatchFile,
      JSON.stringify({ hiddenVendorIds: ["old-vendor"], updatedAt: "2026-06-09T13:00:00.000Z" }),
      "utf8",
    );

    const store = await createStore({ dataDir, databaseFile, legacySubmissionsFile, legacyCatalogPatchFile });
    const submissions = store.readSubmissions();

    expect(submissions).toHaveLength(1);
    expect(submissions[0].vendorName).toBe("竹园二楼12号");
    expect(submissions[0].attachments).toHaveLength(1);
    expect(submissions[0].attachments[0].dataUrl).toBe(sampleImage);
    expect(store.readCatalogPatch().hiddenVendorIds).toEqual(["old-vendor"]);
    await expect(stat(databaseFile)).resolves.toBeTruthy();
    store.close();
  });

  it("stores feedback, updates review status, writes patch data, and clears with a backup", async () => {
    const dataDir = await makeTempDir();
    const databaseFile = path.join(dataDir, "xdufood.sqlite");
    const store = await createStore({
      dataDir,
      databaseFile,
      legacySubmissionsFile: path.join(dataDir, "missing-submissions.jsonl"),
      legacyCatalogPatchFile: path.join(dataDir, "missing-catalog-patch.json"),
    });

    await store.addSubmission({
      id: "student-1",
      kind: "new-dish",
      campus: "south",
      channel: "nearby",
      vendorName: "新综烤肉饭",
      area: "新综",
      suggestedDish: "招牌烤肉饭",
      suggestedTags: "米饭",
      note: "新开窗口",
      status: "pending",
      createdAt: "2026-06-10T01:00:00.000Z",
      attachments: [{ id: "photo-1", name: "dish.png", mimeType: "image/png", size: 5, dataUrl: sampleImage }],
    });

    const reviewed = await store.updateSubmission("student-1", { status: "applied" });
    expect(reviewed[0].status).toBe("applied");
    expect(reviewed[0].reviewedAt).toBe(fixedNow);

    const patch = await store.writeCatalogPatch({ hiddenItemIds: ["bad-item"] });
    expect(patch.updatedAt).toBe(fixedNow);
    expect(store.readCatalogPatch().hiddenItemIds).toEqual(["bad-item"]);

    const backup = await store.clearSubmissions();
    expect(store.readSubmissions()).toEqual([]);
    expect(backup).toMatch(/^submissions-\d+\.jsonl\.bak$/);
    const backupText = await readFile(path.join(dataDir, backup), "utf8");
    expect(backupText).toContain("新综烤肉饭");
    expect(backupText).toContain(sampleImage);
    store.close();
  });
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xdufood-sqlite-"));
  tempDirs.push(dir);
  return dir;
}

function createStore(options) {
  return createSqliteStore({
    ...options,
    now: () => fixedNow,
    logger: { info() {}, warn() {} },
  });
}
