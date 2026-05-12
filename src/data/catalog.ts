import {
  xduBetaCanteenVendors,
  xduOfficialCanteenSourceSummary,
  xduOfficialCanteenVendors,
} from "./xduOfficialCanteens.generated";

const reviewedOfficialVendors = xduOfficialCanteenVendors
  .map((vendor) => ({
    ...vendor,
    items: vendor.items.filter((item) => item.reviewStatus === "approved" && typeof item.price === "number"),
  }))
  .filter((vendor) => vendor.reviewStatus === "approved" && vendor.items.length > 0);

const betaOfficialVendors = xduBetaCanteenVendors
  .map((vendor) => ({
    ...vendor,
    items: vendor.items.filter((item) => item.reviewStatus === "pending" && typeof item.price === "number"),
  }))
  .filter((vendor) => vendor.items.length > 0);

export const foodCatalog = [
  ...reviewedOfficialVendors,
  ...betaOfficialVendors,
];

export const officialCanteenAreas = xduOfficialCanteenSourceSummary.map((source) => ({
  campus: source.campus,
  area: source.area,
  floor: source.floor,
  sourceUrl: source.sourceUrl,
  sourceTitle: source.sourceTitle,
  updatedAt: source.updatedAt,
  imageCount: source.imageCount,
}));

export const officialCanteenStats = {
  sourceCount: xduOfficialCanteenSourceSummary.length,
  reviewedVendorCount: reviewedOfficialVendors.length,
  reviewedDishCount: reviewedOfficialVendors.reduce((sum, vendor) => sum + vendor.items.length, 0),
  betaVendorCount: betaOfficialVendors.length,
  betaDishCount: betaOfficialVendors.reduce((sum, vendor) => sum + vendor.items.length, 0),
};
