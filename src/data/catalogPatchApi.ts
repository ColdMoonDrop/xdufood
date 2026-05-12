import { emptyCatalogPatch, normalizeCatalogPatch, type CatalogPatch } from "./catalogPatch";

const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "";

export async function loadCatalogPatch(): Promise<CatalogPatch> {
  const response = await fetch(`${API_BASE}/api/catalog-patch`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return emptyCatalogPatch;
  const payload = await response.json();
  return normalizeCatalogPatch(payload.patch);
}

export async function saveCatalogPatch(patch: CatalogPatch, token: string): Promise<CatalogPatch> {
  const response = await fetch(`${API_BASE}/api/admin/catalog-patch`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`Failed to save catalog patch: ${response.status}`);
  }
  const payload = await response.json();
  return normalizeCatalogPatch(payload.patch);
}
