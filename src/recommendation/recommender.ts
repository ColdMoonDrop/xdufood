import type { FoodItem, FoodVendor, Recommendation, StudentPreference } from "../domain/food";
import { channelLabels, foodTypeLabels, heatLabels, mealPeriodLabels, vendorChannels } from "../domain/food";

const heatRank: Record<FoodItem["heat"], number> = {
  none: 0,
  mild: 1,
  medium: 2,
  hot: 3,
};

const primaryFoodTypes: FoodItem["types"] = ["rice", "noodle", "western", "snack", "drink"];

export function recommendFood(vendors: FoodVendor[], preference: StudentPreference): Recommendation[] {
  const ranked = vendors
    .map((vendor) => {
      return vendor.items
        .map((item) => scoreCandidate(vendor, item, preference))
        .filter((result) => result.score > 0)
        .sort(compareRecommendations)[0];
    })
    .filter((result): result is Recommendation => Boolean(result))
    .sort(compareRecommendations);

  return selectBalancedRecommendations(ranked, preference);
}

function selectBalancedRecommendations(ranked: Recommendation[], preference: StudentPreference): Recommendation[] {
  const maxResults = 8;
  const shouldBalanceAreas =
    preference.canteenAreas.length === 0 &&
    ranked.filter((result) => isDineInRecommendation(result)).length > 1 &&
    new Set(ranked.filter((result) => isDineInRecommendation(result)).map((result) => result.vendor.area)).size > 1;

  if (shouldBalanceAreas) {
    return selectAreaBalancedRecommendations(ranked, preference, maxResults);
  }

  const selected: Recommendation[] = [];
  const usedDishNames = new Set<string>();
  const usedCandidateKeys = new Set<string>();

  for (const result of ranked) {
    if (usedCandidateKeys.has(candidateKey(result))) continue;
    const dishKey = normalizeDishName(result.item.name);
    if (usedDishNames.has(dishKey)) continue;

    selected.push(result);
    usedCandidateKeys.add(candidateKey(result));
    usedDishNames.add(dishKey);
    if (selected.length >= maxResults) break;
  }

  return selected;
}

function selectAreaBalancedRecommendations(
  ranked: Recommendation[],
  preference: StudentPreference,
  maxResults: number,
): Recommendation[] {
  const groups = new Map<string, Recommendation[]>();
  for (const result of ranked) {
    const area = result.vendor.area || result.vendor.id;
    groups.set(area, [...(groups.get(area) ?? []), result]);
  }

  const areaOrder = Array.from(groups.keys()).sort((a, b) => compareAreaPriority(a, b, groups, preference));
  const selected: Recommendation[] = [];
  const usedDishNames = new Set<string>();
  const usedCandidateKeys = new Set<string>();

  while (selected.length < maxResults) {
    let added = false;

    for (const area of areaOrder) {
      const result = (groups.get(area) ?? []).find((candidate) => {
        return !usedCandidateKeys.has(candidateKey(candidate)) && !usedDishNames.has(normalizeDishName(candidate.item.name));
      });
      if (!result) continue;

      selected.push(result);
      usedCandidateKeys.add(candidateKey(result));
      usedDishNames.add(normalizeDishName(result.item.name));
      added = true;

      if (selected.length >= maxResults) break;
    }

    if (!added) break;
  }

  return selected;
}

function compareAreaPriority(
  a: string,
  b: string,
  groups: Map<string, Recommendation[]>,
  preference: StudentPreference,
) {
  if (typeof preference.randomnessSeed === "number") {
    return (
      stableNoise(`${preference.randomnessSeed}:area:${b}`) - stableNoise(`${preference.randomnessSeed}:area:${a}`) ||
      areaBestScore(b, groups) - areaBestScore(a, groups) ||
      a.localeCompare(b, "zh-CN")
    );
  }

  return areaBestScore(b, groups) - areaBestScore(a, groups) || a.localeCompare(b, "zh-CN");
}

function areaBestScore(area: string, groups: Map<string, Recommendation[]>) {
  return groups.get(area)?.[0]?.score ?? 0;
}

function candidateKey(result: Recommendation) {
  return `${result.vendor.id}:${result.item.id}`;
}

function isDineInRecommendation(result: Recommendation) {
  return vendorChannels(result.vendor).some((channel) => channel === "canteen" || channel === "nearby");
}

function compareRecommendations(a: Recommendation, b: Recommendation) {
  return (
    b.score - a.score ||
    a.vendor.name.localeCompare(b.vendor.name, "zh-CN") ||
    a.item.name.localeCompare(b.item.name, "zh-CN")
  );
}

function scoreCandidate(
  vendor: FoodVendor,
  item: FoodItem,
  preference: StudentPreference,
): Recommendation {
  let score = 40;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const wantedPrimaryTypes = preference.wantedTypes.filter((type) => primaryFoodTypes.includes(type));

  if (wantedPrimaryTypes.length > 0 && !wantedPrimaryTypes.some((type) => item.types.includes(type))) {
    return {
      vendor,
      item,
      score: 0,
      reasons,
      warnings: [`不属于 ${wantedPrimaryTypes.map((type) => foodTypeLabels[type]).join("、")}`],
    };
  }

  if (vendor.campus !== preference.campus) {
    score -= 100;
    warnings.push("不在当前校区");
  } else {
    score += 10;
  }

  if (!item.available.includes(preference.mealPeriod)) {
    return {
      vendor,
      item,
      score: 0,
      reasons,
      warnings: [`${mealPeriodLabels[preference.mealPeriod]} 不营业`],
    };
  }

  score += 12;
  reasons.push(`适合${mealPeriodLabels[preference.mealPeriod]}`);

  const supportedChannels = vendorChannels(vendor);
  if (
    preference.selectedChannels.length > 0 &&
    !supportedChannels.some((channel) => preference.selectedChannels.includes(channel))
  ) {
    return {
      vendor,
      item,
      score: 0,
      reasons,
      warnings: ["不在已选就餐方式内"],
    };
  } else {
    reasons.push(supportedChannels.map((channel) => channelLabels[channel]).join(" / "));
  }

  const isDineInVendor = supportedChannels.some((channel) => channel === "canteen" || channel === "nearby");
  if (isDineInVendor && preference.canteenAreas.length > 0 && !preference.canteenAreas.includes(vendor.area)) {
    return {
      vendor,
      item,
      score: 0,
      reasons,
      warnings: ["不在已选堂食地点"],
    };
  } else if (isDineInVendor) {
    reasons.push(vendor.area);
  }

  const matchedWanted = preference.wantedTypes.filter((type) => item.types.includes(type) || vendor.tags.includes(type));
  if (matchedWanted.length > 0) {
    score += matchedWanted.length * 14;
    reasons.push(`命中 ${matchedWanted.map((type) => foodTypeLabels[type]).join("、")}`);
  }

  if (
    wantedPrimaryTypes.length === 0 &&
    item.types.includes("drink") &&
    !item.types.some((type) => ["rice", "noodle", "snack", "western", "protein"].includes(type))
  ) {
    score -= 18;
  }

  const avoided = preference.avoidTypes.filter((type) => item.types.includes(type) || vendor.tags.includes(type));
  if (avoided.length > 0) {
    score -= avoided.length * 22;
    warnings.push(`包含你想避开的 ${avoided.map((type) => foodTypeLabels[type]).join("、")}`);
  }

  if (preference.heat !== "any") {
    const heatDistance = Math.abs(heatRank[item.heat] - heatRank[preference.heat]);
    if (heatDistance === 0) {
      score += 10;
      reasons.push(`辣度是${heatLabels[item.heat]}`);
    } else {
      score -= heatDistance * 6;
    }
  }

  if (preference.needVegetarian) {
    if (item.types.includes("vegetarian")) {
      score += 16;
      reasons.push("素食友好");
    } else {
      score -= 60;
      warnings.push("不满足素食需求");
    }
  }

  if (preference.needHalal) {
    if (item.types.includes("halal") || vendor.tags.includes("halal")) {
      score += 18;
      reasons.push("清真友好");
    } else {
      score -= 80;
      warnings.push("不满足清真需求");
    }
  }

  if (typeof vendor.rating === "number") {
    score += vendor.rating * 4;
  }
  score += item.popularity * 12;
  score -= (vendor.busyLevel ?? 0.45) * 8;

  const itemKey = `${vendor.id}:${item.id}`;
  const recentItemIds = preference.recentItemIds ?? [];
  if (recentItemIds.includes(itemKey) || recentItemIds.includes(item.id)) {
    score -= 28;
    warnings.push("最近吃过，已降权");
  } else if (recentItemIds.some((key) => key.startsWith(`${vendor.id}:`))) {
    score -= 8;
  }

  if (typeof preference.randomnessSeed === "number") {
    const jitter = stableNoise(`${preference.randomnessSeed}:${vendor.id}:${item.id}`);
    score += Math.round(jitter * 14) - 4;
    reasons.push("加入轮换随机性");
  }

  return {
    vendor,
    item,
    score: Math.round(Math.max(0, score)),
    reasons: unique(reasons).slice(0, 4),
    warnings: unique(warnings).slice(0, 3),
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function stableNoise(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function normalizeDishName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[·.。()\[\]（）【】\s]/g, "")
    .replace(/逍遥镇/g, "")
    .replace(/大份|小份|加量|普通/g, "")
    .toLowerCase();
}
