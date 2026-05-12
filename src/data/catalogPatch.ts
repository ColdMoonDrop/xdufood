import type { FoodItem, FoodVendor } from "../domain/food";

export interface CatalogPatch {
  vendorOverrides: Record<string, Partial<FoodVendor>>;
  itemOverrides: Record<string, Partial<FoodItem>>;
  addedVendors: FoodVendor[];
  addedItems: Record<string, FoodItem[]>;
  hiddenVendorIds: string[];
  hiddenItemIds: string[];
  updatedAt?: string;
}

export const emptyCatalogPatch: CatalogPatch = {
  vendorOverrides: {},
  itemOverrides: {},
  addedVendors: [],
  addedItems: {},
  hiddenVendorIds: [],
  hiddenItemIds: [],
};

export function applyCatalogPatch(baseCatalog: FoodVendor[], patch: CatalogPatch): FoodVendor[] {
  const hiddenVendors = new Set(patch.hiddenVendorIds);
  const hiddenItems = new Set(patch.hiddenItemIds);
  const patchedBase = baseCatalog
    .filter((vendor) => !hiddenVendors.has(vendor.id))
    .map((vendor) => {
      const vendorPatch = patch.vendorOverrides[vendor.id] ?? {};
      const patchedVendor: FoodVendor = {
        ...vendor,
        ...vendorPatch,
        items: vendor.items
          .filter((item) => !hiddenItems.has(itemKey(vendor.id, item.id)))
          .map((item) => ({
            ...item,
            ...(patch.itemOverrides[itemKey(vendor.id, item.id)] ?? {}),
          })),
      };
      const extraItems = patch.addedItems[vendor.id] ?? [];
      return {
        ...patchedVendor,
        items: [...patchedVendor.items, ...extraItems.filter((item) => !hiddenItems.has(itemKey(vendor.id, item.id)))],
      };
    });

  const addedVendors = patch.addedVendors.filter((vendor) => !hiddenVendors.has(vendor.id));
  return [...patchedBase, ...addedVendors];
}

export function normalizeCatalogPatch(value: unknown): CatalogPatch {
  if (!value || typeof value !== "object") return emptyCatalogPatch;
  const patch = value as Partial<CatalogPatch>;
  return {
    vendorOverrides: isObjectRecord(patch.vendorOverrides) ? patch.vendorOverrides : {},
    itemOverrides: isObjectRecord(patch.itemOverrides) ? patch.itemOverrides : {},
    addedVendors: Array.isArray(patch.addedVendors) ? patch.addedVendors : [],
    addedItems: isObjectRecord(patch.addedItems) ? patch.addedItems : {},
    hiddenVendorIds: Array.isArray(patch.hiddenVendorIds) ? patch.hiddenVendorIds.filter(isString) : [],
    hiddenItemIds: Array.isArray(patch.hiddenItemIds) ? patch.hiddenItemIds.filter(isString) : [],
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : undefined,
  };
}

export function itemKey(vendorId: string, itemId: string) {
  return `${vendorId}:${itemId}`;
}

function isObjectRecord(value: unknown): value is Record<string, never> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
