import {
  xduWechatTextCanteenSourceSummary,
  xduWechatTextCanteenVendors,
} from "./xduWechatTextCanteens.generated";

const wechatTextVendors = xduWechatTextCanteenVendors
  .map((vendor) => ({
    ...vendor,
    items: vendor.items.filter((item) => item.sourceMethod === "html-text" && item.reviewStatus === "pending"),
  }))
  .filter((vendor) => vendor.sourceMethod === "html-text" && vendor.items.length > 0);

export const foodCatalog = [
  ...wechatTextVendors,
];

export const officialCanteenAreas = xduWechatTextCanteenSourceSummary.map((source) => ({
  campus: source.campus,
  area: source.area,
  floor: source.floor,
  sourceUrl: source.sourceUrl,
  sourceTitle: source.sourceTitle,
  updatedAt: source.updatedAt,
  imageCount: source.imageCount,
}));

export const officialCanteenStats = {
  sourceCount: xduWechatTextCanteenSourceSummary.length,
  reviewedVendorCount: 0,
  reviewedDishCount: 0,
  betaVendorCount: wechatTextVendors.length,
  betaDishCount: wechatTextVendors.reduce((sum, vendor) => sum + vendor.items.length, 0),
};
