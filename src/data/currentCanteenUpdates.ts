import type { FoodItem, FoodVendor, HeatLevel, FoodType } from "../domain/food";

const zhuyuan2f10 = "竹园二层餐厅 · 二层 · 10号窗口 · 勺伯石锅菜";
const zhuyuan2f12 = "竹园二层餐厅 · 二层 · 12号窗口 · 烤肉拌饭";
const updatedAt = "2026-05-17";

export const currentCanteenHiddenVendorIds = [
  "zhuyuan-2f-10-一粉一城新疆炒米粉-b7c3a31a",
  "zhuyuan-2f-12-三汁焖锅-716f70bb",
];

export const currentCanteenVendors: FoodVendor[] = [
  {
    id: "zhuyuan-2f-10-shao-bo-stone-pot-dish-20260517",
    name: "竹园二层餐厅 10# · 勺伯石锅菜",
    campus: "south",
    channel: "canteen",
    area: "竹园二层餐厅",
    floor: "二层",
    windowNo: "10",
    windowName: "勺伯石锅菜",
    locationHint: zhuyuan2f10,
    distanceMinutes: 7,
    tags: ["rice", "protein", "spicy"],
    source: "学生现场照片",
    updatedAt,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
    items: [
      ...stonePotItems("麻辣", "hot", [
        "石锅麻辣肉沫鸡蛋",
        "石锅麻辣肉沫豆腐",
        "石锅麻辣片片鸡",
        "石锅麻辣烤肉",
        "石锅麻辣小酥肉",
        "石锅麻辣瓦罐鱼",
        "石锅麻辣鸡块",
        "石锅麻辣肥肠鸡",
      ]),
      ...stonePotItems("酱烧", "none", [
        "石锅酱烧肉沫鸡蛋",
        "石锅酱烧肉沫豆腐",
        "石锅酱烧片片鸡",
        "石锅酱烧烤肉",
        "石锅酱烧小酥肉",
        "石锅酱烧瓦罐鱼",
        "石锅酱烧鸡块",
        "石锅酱烧肥肠鸡",
      ]),
      ...stonePotItems("蒜香", "none", [
        "石锅蒜香肉沫鸡蛋",
        "石锅蒜香肉沫豆腐",
        "石锅蒜香片片鸡",
        "石锅蒜香烤肉",
        "石锅蒜香小酥肉",
        "石锅蒜香瓦罐鱼",
        "石锅蒜香鸡块",
        "石锅蒜香肥肠鸡",
      ]),
    ],
  },
  {
    id: "zhuyuan-2f-12-kaorou-ban-fan-20260517",
    name: "竹园二层餐厅 12# · 烤肉拌饭",
    campus: "south",
    channel: "canteen",
    area: "竹园二层餐厅",
    floor: "二层",
    windowNo: "12",
    windowName: "烤肉拌饭",
    locationHint: zhuyuan2f12,
    distanceMinutes: 7,
    tags: ["rice", "protein", "spicy"],
    source: "学生现场照片",
    updatedAt,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
    items: [
      barbecueRiceItem("烤筋拌饭"),
      barbecueRiceItem("烤脆皮鸡拌饭"),
      barbecueRiceItem("烤五花肉拌饭"),
    ],
  },
];

function stonePotItems(flavor: string, heat: HeatLevel, entries: string[]): FoodItem[] {
  return entries.map((name) => ({
    id: `zhuyuan-2f-10-shao-bo-${slugify(name)}`,
    name,
    types: ["rice", "protein", ...(flavor === "麻辣" ? (["spicy"] satisfies FoodType[]) : [])],
    heat,
    popularity: flavor === "麻辣" ? 0.9 : 0.86,
    available: ["lunch", "dinner"],
    description: `${zhuyuan2f10} 当前菜单。`,
    windowNo: "10",
    windowName: "勺伯石锅菜",
    locationHint: zhuyuan2f10,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
  }));
}

function barbecueRiceItem(name: string): FoodItem {
  return {
    id: `zhuyuan-2f-12-kaorou-${slugify(name)}`,
    name,
    types: ["rice", "protein", "spicy"],
    heat: "mild",
    popularity: 0.88,
    available: ["lunch", "dinner"],
    description: `${zhuyuan2f12} 当前菜单。`,
    windowNo: "12",
    windowName: "烤肉拌饭",
    locationHint: zhuyuan2f12,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
  };
}

function slugify(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
