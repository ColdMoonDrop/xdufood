import { describe, expect, it } from "vitest";
import { foodCatalog } from "../data/catalog";
import {
  xduWechatTextCanteenSourceSummary,
  xduWechatTextCanteenVendors,
} from "../data/xduWechatTextCanteens.generated";
import type { FoodVendor, StudentPreference } from "../domain/food";
import { recommendFood } from "./recommender";

const basePreference: StudentPreference = {
  campus: "south",
  budget: 18,
  mealPeriod: "lunch",
  selectedChannels: ["canteen", "delivery", "nearby"],
  canteenAreas: [],
  wantedTypes: [],
  avoidTypes: [],
  heat: "any",
  needVegetarian: false,
  needHalal: false,
};

describe("recommendFood", () => {
  it("keeps recommendations on the selected campus and within the meal period", () => {
    const results = recommendFood(foodCatalog, basePreference);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.vendor.campus === "south")).toBe(true);
    expect(results.every((result) => result.item.available.includes("lunch"))).toBe(true);
  });

  it("prioritizes halal options when the student requires halal food", () => {
    const halalFixture: FoodVendor[] = [
      {
        id: "test-halal",
        name: "清真窗口",
        campus: "south",
        channel: "canteen",
        area: "测试食堂",
        distanceMinutes: 5,
        tags: ["halal", "noodle", "protein"],
        source: "测试数据",
        updatedAt: "2026-05-09",
        items: [
          {
            id: "test-halal-noodle",
            name: "牛肉拉面",
            price: 14,
            types: ["halal", "noodle", "protein"],
            heat: "none",
            popularity: 0.8,
            available: ["lunch", "dinner"],
            description: "测试用清真餐品。",
          },
        ],
      },
    ];
    const results = recommendFood([...foodCatalog, ...halalFixture], {
      ...basePreference,
      needHalal: true,
      wantedTypes: ["halal"],
    });

    expect(results[0].item.types.includes("halal") || results[0].vendor.tags.includes("halal")).toBe(true);
  });

  it("can recommend vegetarian food when requested", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      needVegetarian: true,
      wantedTypes: ["vegetarian", "light"],
      budget: 24,
    });

    expect(results[0].item.types).toContain("vegetarian");
  });

  it("can restrict canteen recommendations to selected official dining areas", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen"],
      canteenAreas: ["海棠一层餐厅"],
      wantedTypes: ["rice"],
      budget: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].vendor.channel).toBe("canteen");
    expect(results[0].vendor.area).toBe("海棠一层餐厅");
    expect(results[0].vendor.source).toContain("西电后勤公众号");
  });

  it("treats selected staple categories as hard item filters", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      wantedTypes: ["rice", "protein"],
      budget: 30,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.item.types.includes("rice"))).toBe(true);
  });

  it("does not invent late-night options when official canteen data has none", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      mealPeriod: "late",
      selectedChannels: ["canteen", "nearby"],
      wantedTypes: ["light"],
      budget: 30,
    });

    expect(results.every((result) => result.item.available.includes("late"))).toBe(true);
  });

  it("keeps comprehensive building locations empty until students submit approved data", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen", "nearby"],
      canteenAreas: ["老综"],
      wantedTypes: ["light"],
      budget: 30,
    });

    expect(results).toHaveLength(0);
  });

  it("matches South Campus shared merchants by any supported channel", () => {
    const sharedVendor: FoodVendor = {
      id: "south-shared-building-test",
      name: "综合楼学生共建商家",
      campus: "south",
      channel: "nearby",
      supportedChannels: ["nearby", "delivery"],
      area: "南校区综合楼",
      distanceMinutes: 9,
      deliveryMinutes: 25,
      tags: ["rice", "protein"],
      source: "测试数据",
      updatedAt: "2026-05-10",
      items: [
        {
          id: "shared-rice-test",
          name: "鸡腿饭",
          price: 18,
          types: ["rice", "protein"],
          heat: "none",
          popularity: 0.8,
          available: ["lunch", "dinner"],
          description: "测试用综合楼堂食外卖双支持餐品。",
        },
      ],
    };

    const deliveryResults = recommendFood([sharedVendor], {
      ...basePreference,
      selectedChannels: ["delivery"],
      wantedTypes: ["rice"],
    });
    const dineInResults = recommendFood([sharedVendor], {
      ...basePreference,
      selectedChannels: ["nearby"],
      wantedTypes: ["rice"],
    });

    expect(deliveryResults[0]?.vendor.id).toBe(sharedVendor.id);
    expect(dineInResults[0]?.vendor.id).toBe(sharedVendor.id);
  });

  it("uses one representative dish per vendor so large menus do not occupy multiple recommendation slots", () => {
    const menuHeavyVendor: FoodVendor = {
      id: "test-heavy-menu",
      name: "很多盖饭的窗口",
      campus: "south",
      channel: "canteen",
      area: "测试食堂",
      distanceMinutes: 4,
      tags: ["rice", "protein"],
      source: "测试数据",
      updatedAt: "2026-05-10",
      items: [
        {
          id: "heavy-rice-1",
          name: "鸡腿饭",
          price: 16,
          types: ["rice", "protein"],
          heat: "none",
          popularity: 0.95,
          available: ["lunch", "dinner"],
          description: "测试用餐品。",
        },
        {
          id: "heavy-rice-2",
          name: "排骨饭",
          price: 17,
          types: ["rice", "protein"],
          heat: "none",
          popularity: 0.94,
          available: ["lunch", "dinner"],
          description: "测试用餐品。",
        },
        {
          id: "heavy-rice-3",
          name: "卤肉饭",
          price: 15,
          types: ["rice", "protein"],
          heat: "none",
          popularity: 0.93,
          available: ["lunch", "dinner"],
          description: "测试用餐品。",
        },
      ],
    };
    const smallVendor: FoodVendor = {
      id: "test-small-menu",
      name: "单品窗口",
      campus: "south",
      channel: "canteen",
      area: "测试食堂",
      distanceMinutes: 5,
      tags: ["rice", "protein"],
      source: "测试数据",
      updatedAt: "2026-05-10",
      items: [
        {
          id: "small-rice-1",
          name: "番茄鸡蛋饭",
          price: 14,
          types: ["rice", "protein"],
          heat: "none",
          popularity: 0.72,
          available: ["lunch", "dinner"],
          description: "测试用餐品。",
        },
      ],
    };

    const results = recommendFood([menuHeavyVendor, smallVendor], {
      ...basePreference,
      selectedChannels: ["canteen"],
      wantedTypes: ["rice"],
      budget: 20,
      randomnessSeed: 20260510,
    });

    expect(results).toHaveLength(2);
    expect(new Set(results.map((result) => result.vendor.id)).size).toBe(results.length);
    expect(results.filter((result) => result.vendor.id === menuHeavyVendor.id)).toHaveLength(1);
    expect(results.some((result) => result.vendor.id === smallVendor.id)).toBe(true);
  });

  it("balances canteen areas when no dining location is selected", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen"],
      canteenAreas: [],
      wantedTypes: [],
      randomnessSeed: 20260517,
    });

    expect(results.length).toBeGreaterThan(4);
    expect(new Set(results.map((result) => result.vendor.area)).size).toBeGreaterThan(3);
  });

  it("rotates the first canteen area when no dining location is selected", () => {
    const areaFixture: FoodVendor[] = ["丁香二层餐厅", "海棠一层餐厅", "竹园一层餐厅", "西区一层餐厅"].map(
      (area, index) => ({
        id: `test-area-${index}`,
        name: `${area} 测试窗口`,
        campus: "south",
        channel: "canteen",
        area,
        distanceMinutes: 5,
        tags: ["rice", "protein"],
        source: "测试数据",
        updatedAt: "2026-05-17",
        items: [
          {
            id: `test-area-item-${index}`,
            name: `${area} 推荐饭`,
            price: 15,
            types: ["rice", "protein"],
            heat: "none",
            popularity: 0.8,
            available: ["lunch", "dinner"],
            description: "测试用餐品。",
          },
        ],
      }),
    );

    const firstAreas = new Set(
      Array.from({ length: 20 }, (_, index) =>
        recommendFood(areaFixture, {
          ...basePreference,
          selectedChannels: ["canteen"],
          canteenAreas: [],
          wantedTypes: [],
          randomnessSeed: index + 1,
        })[0]?.vendor.area,
      ),
    );

    expect(firstAreas.size).toBeGreaterThan(1);
  });

  it("does not repeat the same dish name across different vendors in one batch", () => {
    const hulatangVendors: FoodVendor[] = [1, 2, 3].map((index) => ({
      id: `test-hulatang-${index}`,
      name: `${index}号早餐窗口`,
      campus: "south",
      channel: "canteen",
      area: "测试食堂",
      distanceMinutes: 4 + index,
      tags: ["snack", "local"],
      source: "测试数据",
      updatedAt: "2026-05-10",
      items: [
        {
          id: `hula-${index}`,
          name: "逍遥镇胡辣汤",
          price: 6,
          types: ["snack", "local"],
          heat: "mild",
          popularity: 0.9,
          available: ["breakfast"],
          description: "测试用早餐。",
        },
      ],
    }));
    const baoziVendor: FoodVendor = {
      id: "test-breakfast-baozi",
      name: "包子窗口",
      campus: "south",
      channel: "canteen",
      area: "测试食堂",
      distanceMinutes: 6,
      tags: ["snack"],
      source: "测试数据",
      updatedAt: "2026-05-10",
      items: [
        {
          id: "baozi",
          name: "鲜肉包",
          price: 3,
          types: ["snack"],
          heat: "none",
          popularity: 0.7,
          available: ["breakfast"],
          description: "测试用早餐。",
        },
      ],
    };

    const results = recommendFood([...hulatangVendors, baoziVendor], {
      ...basePreference,
      mealPeriod: "breakfast",
      selectedChannels: ["canteen"],
      wantedTypes: ["snack"],
      budget: 12,
    });

    expect(results.filter((result) => result.item.name.includes("胡辣汤"))).toHaveLength(1);
    expect(results.some((result) => result.item.name === "鲜肉包")).toBe(true);
  });

  it("includes direct WeChat article text canteen data from XDU logistics", () => {
    const results = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen"],
      canteenAreas: ["海棠一层餐厅"],
      wantedTypes: ["rice"],
      budget: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.vendor.source.includes("西电后勤公众号"))).toBe(true);
    expect(results.every((result) => result.vendor.source.includes("正文菜单"))).toBe(true);
    expect(results.every((result) => result.item.sourceMethod === "html-text")).toBe(true);
    expect(results.every((result) => result.item.price === undefined)).toBe(true);
    expect(results.every((result) => result.item.reviewStatus === "pending")).toBe(true);
  });

  it("includes text canteen candidates as clearly pending student-calibration data", () => {
    const betaResults = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen"],
      wantedTypes: ["rice", "noodle"],
      budget: 22,
      randomnessSeed: 12345,
    }).filter((result) => result.item.reviewStatus === "pending");

    expect(betaResults.length).toBeGreaterThan(0);
    expect(betaResults.every((result) => result.vendor.source.includes("正文菜单待校准"))).toBe(true);
    expect(betaResults.every((result) => result.item.sourceMethod === "html-text")).toBe(true);
  });

  it("only includes canteen data and reviewed student menu corrections in the base catalog", () => {
    expect(foodCatalog.length).toBeGreaterThan(0);
    expect(foodCatalog.every((vendor) => vendor.channel === "canteen")).toBe(true);
    expect(foodCatalog.every((vendor) => vendor.source.includes("西电后勤公众号") || vendor.source.includes("学生现场照片"))).toBe(true);
    expect(foodCatalog.some((vendor) => vendor.source.includes("样例") || vendor.source.includes("平台导入"))).toBe(false);
  });

  it("uses current student-photo updates for Zhuyuan second-floor windows 10 and 12", () => {
    const zhuyuan2f = foodCatalog.filter((vendor) => vendor.area === "竹园二层餐厅");
    expect(zhuyuan2f.some((vendor) => vendor.id === "zhuyuan-2f-10-一粉一城新疆炒米粉-b7c3a31a")).toBe(false);
    expect(zhuyuan2f.some((vendor) => vendor.id === "zhuyuan-2f-12-三汁焖锅-716f70bb")).toBe(false);
    expect(zhuyuan2f.find((vendor) => vendor.windowNo === "10")?.windowName).toBe("勺伯石锅菜");
    expect(zhuyuan2f.find((vendor) => vendor.windowNo === "12")?.windowName).toBe("烤肉拌饭");
    expect(zhuyuan2f.find((vendor) => vendor.windowNo === "10")?.items.map((item) => item.name)).toContain("石锅麻辣烤肉");
    expect(zhuyuan2f.find((vendor) => vendor.windowNo === "12")?.items.map((item) => item.name)).toContain("烤五花肉拌饭");

    const results = recommendFood(foodCatalog, {
      ...basePreference,
      selectedChannels: ["canteen"],
      canteenAreas: ["竹园二层餐厅"],
      wantedTypes: ["rice"],
      randomnessSeed: 1,
    });
    expect(results.some((result) => result.vendor.windowName === "勺伯石锅菜")).toBe(true);
    expect(results.some((result) => result.vendor.windowName === "烤肉拌饭")).toBe(true);
  });

  it("keeps WeChat text source metadata and item ids well formed", () => {
    expect(xduWechatTextCanteenSourceSummary.length).toBe(11);
    expect(xduWechatTextCanteenVendors.length).toBeGreaterThan(200);

    const vendorIds = new Set<string>();
    const itemIds = new Set<string>();

    for (const vendor of xduWechatTextCanteenVendors) {
      expect(vendorIds.has(vendor.id)).toBe(false);
      vendorIds.add(vendor.id);
      expect(vendor.sourceUrl).toMatch(/^https:\/\/mp.weixin.qq.com\//);
      expect(vendor.sourceMethod).toBe("html-text");
      expect(vendor.reviewStatus).toBe("pending");
      expect(vendor.floor).not.toMatch(/号窗口/);
      expect(vendor.locationHint ?? "").toContain(vendor.area);

      for (const item of vendor.items) {
        expect(itemIds.has(item.id)).toBe(false);
        itemIds.add(item.id);
        expect(item.reviewStatus).toBe("pending");
        expect(item.sourceMethod).toBe("html-text");
        expect(item.price).toBeUndefined();
        expect(item.available.length).toBeGreaterThan(0);
        expect(item.locationHint ?? "").toContain(vendor.area);
        expect(item.name).not.toMatch(/滑动|查看更多/);
        expect(item.name).not.toMatch(/[（）()]/);
        expect([
          "麻辣",
          "香辣",
          "微辣",
          "中辣",
          "重辣",
          "番茄",
          "金汤",
          "三鲜",
          "酸菜",
          "黑椒",
          "藤椒",
          "原味",
          "清香",
          "香辣味",
          "烧烤味",
          "酸辣等口味",
        ]).not.toContain(item.name);
      }
    }
  });
});
