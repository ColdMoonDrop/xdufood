export type Campus = "south" | "north";

export type Channel = "canteen" | "delivery" | "nearby";

export type FoodType =
  | "rice"
  | "noodle"
  | "spicy"
  | "light"
  | "snack"
  | "western"
  | "drink"
  | "vegetarian"
  | "halal"
  | "protein"
  | "local";

export type MealPeriod = "breakfast" | "lunch" | "dinner" | "late";

export type HeatLevel = "none" | "mild" | "medium" | "hot";

export type SourceMethod = "html-text" | "ocr" | "manual-review";

export type ReviewStatus = "pending" | "approved" | "rejected";

export type SourceImageKind = "menu" | "map" | "slogan" | "other";

export interface FoodItem {
  id: string;
  name: string;
  price?: number;
  types: FoodType[];
  heat: HeatLevel;
  calories?: number;
  popularity: number;
  available: MealPeriod[];
  description: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceImageUrl?: string;
  sourceMethod?: SourceMethod;
  reviewStatus?: ReviewStatus;
  ocrConfidence?: number;
  windowNo?: string;
  windowName?: string;
  locationHint?: string;
  imageKind?: SourceImageKind;
  parseWarnings?: string[];
  duplicateCount?: number;
}

export interface FoodVendor {
  id: string;
  name: string;
  campus: Campus;
  channel: Channel;
  supportedChannels?: Channel[];
  area: string;
  floor?: string;
  windowNo?: string;
  windowName?: string;
  locationHint?: string;
  distanceMinutes: number;
  deliveryMinutes?: number;
  rating?: number;
  busyLevel?: number;
  tags: FoodType[];
  source: string;
  sourceUrl?: string;
  sourceTitle?: string;
  updatedAt: string;
  sourceMethod?: SourceMethod;
  reviewStatus?: ReviewStatus;
  ocrConfidence?: number;
  duplicateCount?: number;
  items: FoodItem[];
}

export interface StudentPreference {
  campus: Campus;
  budget: number;
  mealPeriod: MealPeriod;
  selectedChannels: Channel[];
  canteenAreas: string[];
  wantedTypes: FoodType[];
  avoidTypes: FoodType[];
  heat: "any" | HeatLevel;
  needVegetarian: boolean;
  needHalal: boolean;
  randomnessSeed?: number;
  recentItemIds?: string[];
}

export interface Recommendation {
  vendor: FoodVendor;
  item: FoodItem;
  score: number;
  reasons: string[];
  warnings: string[];
}

export const campusLabels: Record<Campus, string> = {
  south: "南校区",
  north: "北校区",
};

export const channelLabels: Record<Channel, string> = {
  canteen: "校内堂食",
  delivery: "外卖",
  nearby: "周边堂食",
};

export const foodTypeLabels: Record<FoodType, string> = {
  rice: "米饭套餐",
  noodle: "面/粉",
  spicy: "重口辣",
  light: "清淡",
  snack: "小吃",
  western: "西餐",
  drink: "饮品甜点",
  vegetarian: "素食友好",
  halal: "清真",
  protein: "高蛋白",
  local: "陕西本地",
};

export const mealPeriodLabels: Record<MealPeriod, string> = {
  breakfast: "早饭",
  lunch: "午饭",
  dinner: "晚饭",
  late: "夜宵",
};

export function vendorChannels(vendor: Pick<FoodVendor, "channel" | "supportedChannels">): Channel[] {
  return Array.from(new Set([vendor.channel, ...(vendor.supportedChannels ?? [])]));
}

export const heatLabels: Record<HeatLevel, string> = {
  none: "不辣",
  mild: "微辣",
  medium: "中辣",
  hot: "重辣",
};
