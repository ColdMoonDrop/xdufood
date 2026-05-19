import type { Channel, FoodItem, FoodType, FoodVendor, HeatLevel, MealPeriod } from "../domain/food";

const updatedAt = "2026-05-19";
const source = "学生整理平台菜单";
const sourceTitle = "综合楼、家属区和部分食堂外卖档口整理菜单";

const rawRows = `
瑞幸咖啡(西电南校区店),西综合楼一层1035号,07:30-22:30,美团独家,生椰拿铁；标准美式；厚乳拿铁；椰云拿铁
书亦烧仙草(西电南校区店),新综合楼X-1-13-2,10:00-23:00,双平台,经典书亦烧仙草；葡萄芋圆冻冻；茉莉奶绿；鸭屎香柠檬茶
益禾堂(西电南校校内店),新综合楼内,10:00-22:30,双平台,益禾烤奶；杨枝甘露；西瓜汁；薄荷奶绿
茗花有煮(西安电子科技大学店),新综合楼内最北侧,10:00-22:00,双平台,伯牙绝弦；桂馥兰香；青青糯山
美食坊盖浇饭,新综合楼一楼,10:30-21:30,双平台,鱼香肉丝盖浇饭；土豆烧牛肉盖浇饭；西红柿鸡蛋盖浇饭
老陕面(西电西综美食坊店),西综合楼x-1,10:30-21:00,双平台,油泼面；臊子面；biangbiang面；西红柿鸡蛋面
霸舌生滚牛肉米粉(西电南校区店),综合楼X-1-26,10:00-22:00,双平台,原汤吊龙牛肉粉；泡椒吊龙牛肉粉；番茄牛肉丸粉
云鲜鲜生烫牛肉米线店,综合楼东街1层d-1-34号（原尚味轩）,10:30-21:30,双平台,招牌生烫牛肉米线；番茄肥牛米线；酸菜鱼片米线
王宴椒姬餐饮店,综合楼xd-3053号（2026.5.15新开业）,11:00-22:00,双平台,招牌椒麻鸡；藤椒肥牛饭；麻辣香锅
川湘会馆（西电新校区）,西综合楼二楼,11:00-21:00,双平台,小炒黄牛肉；剁椒鱼头；干锅有机花菜；麻婆豆腐
周记开心花甲(西电店),综合楼西街1层,11:00-22:00,双平台,招牌花甲粉；锡纸金针菇；花甲+肥牛双拼
新疆烤肉饭(西电南校区店),综合楼西街1层,10:30-21:30,双平台,招牌烤肉饭；烤肉+鸡排双拼饭；新疆炒米粉
E家寿司屋,综合楼西街一层,10:30-21:00,双平台,招牌寿司卷；三文鱼寿司；鳗鱼寿司；寿司拼盘
黄银旺鸡公煲餐饮店,综合楼西楼一层12-1号,11:00-22:00,双平台,小份鸡公煲；中份鸡公煲；配菜
小四川小炒西电店,综合楼二楼楼梯口,11:00-21:00,双平台,鱼香肉丝；回锅肉；麻婆豆腐；酸辣土豆丝
蘑菇爱上饭(西电店),综合楼东街2层X-2-23号,10:30-21:30,双平台,招牌菌菇饭；黑椒牛肉饭；番茄牛腩饭
舌尖辣条(西电店),综合楼X-1-24,10:00-22:00,双平台,手工辣条；辣条夹馍；麻辣豆皮
美食坊餐厅(西电店),西综合楼x-124,10:30-21:30,双平台,各类盖浇饭；面食；炒菜
吉品轩餐厅(西电店),综合楼西街1层（原美味轩）,10:30-21:30,双平台,黄焖鸡米饭；排骨米饭；各类小炒
迈德思克(西电店),新综合楼1层,09:00-22:00,双平台,香辣鸡腿堡；薯条；可乐；全家桶
华莱士(西安电子科技大学店),新综合楼1层,08:00-23:00,双平台,香辣鸡排堡；鸡米花；蜜汁手扒鸡
张老三牛羊肉泡馍,西综合楼一楼,10:30-21:00,双平台,羊肉泡馍；牛肉泡馍；腊汁肉夹馍
过桥米线(西电店),西综合楼二楼,10:30-21:30,双平台,招牌过桥米线；番茄米线；麻辣米线
韩式石锅拌饭,西综合楼东街1层,10:30-21:00,双平台,石锅拌饭；泡菜汤；大酱汤
正新鸡排(西电店),新综合楼1层,10:00-22:00,双平台,招牌鸡排；烤肠；酸梅汤
蜜雪冰城(西综店),西综合楼一层,10:00-22:30,双平台,冰鲜柠檬水；珍珠奶茶；摩天脆脆
绝味鸭脖(西电南校区店),新综合楼1层,10:00-22:00,双平台,鸭脖；鸭翅；素菜
同州食坊,西电新校区综合楼二层,11:00-21:00,双平台,炒菜；盖浇饭；大盘鸡
0090汉堡工厂,西综合楼负一层,10:00-22:00,双平台,牛肉汉堡；炸鸡套餐；薯条
小洺麻辣拌,西综合楼负一层,10:30-21:30,双平台,素菜；荤菜；汤底
燃也摇滚炒鸡,西综合楼负一层,11:00-21:00,双平台,摇滚炒鸡单人餐；双人餐；拌面
膳当家黄焖鸡米饭(电子科技大学店),老综合楼2层d-2-48号,10:30-22:00,美团独家,经典黄焖鸡；鲍汁茄子煲；黄焖排骨
坤瑞烤汁饭店,东综合楼一楼1-41-3,10:30-21:30,双平台,招牌烤汁饭；黑椒烤肉饭；蜜汁叉烧饭
重庆鸡公煲(西安电子科技大学店),综合楼东街d-2-57号,11:00-22:00,双平台,小份鸡公煲；中份鸡公煲；配菜
化隆牛肉面(西电店),东综合楼内,07:00-21:00,双平台,兰州牛肉面；牛肉拉面；牛肉炒面；牛肉盖浇饭
杨国福麻辣烫(竹园一路店),东综合楼东街一层,10:30-22:00,美团独家,素菜；荤菜；汤底
老潼关肉夹馍(西电老综店),东综合楼一楼,07:30-21:30,双平台,腊汁肉夹馍；凉皮；冰峰；套餐
沙县小吃(西电老综店),东综合楼内,07:00-22:00,双平台,蒸饺；拌面；扁食汤；鸡腿饭
五谷渔粉(西电老综店),东综合楼二楼,10:30-21:30,双平台,招牌五谷渔粉；番茄渔粉；麻辣渔粉；肥牛渔粉
川渝冒菜(西电店),东综合楼二楼,10:30-21:30,双平台,素菜；荤菜；汤底
螺蛳粉(西电老综店),东综合楼一楼,10:30-21:30,双平台,原味螺蛳粉；加炸蛋；加肥肠
黄焖鸡米饭(老综二店),东综合楼二楼,10:30-21:30,双平台,小份黄焖鸡；中份；配菜
渝香源川菜,东综合楼二楼,11:00-21:00,双平台,扬州炒饭；鱼香肉丝；回锅肉；麻婆豆腐
重庆煲王,东综合楼二楼,11:00-21:00,双平台,小份煲；中份煲；配菜
鱼之漫豚骨拉面,东综合楼一楼,10:30-21:30,双平台,招牌豚骨拉面；番茄拉面；加面
麻小鸭水煮肉片,东综合楼二楼,10:30-21:00,双平台,水煮肉片单人餐；水煮鱼单人餐；米饭
云南傣家过桥米线,东综合楼一楼,10:30-21:30,双平台,招牌过桥米线；酸辣米线；麻辣米线
齐鲁二叔大块牛肉面,东综合楼一楼,10:30-21:00,仅堂食,大块牛肉面；牛肉拌面；肉夹馍
亦鱼亦饭,东综合楼二楼,10:30-21:00,饿了么独家,酸菜鱼米饭；番茄鱼米饭；麻辣鱼米饭
蜀渝蜀二菜馆(西电店),东综合楼二楼,11:00-21:00,双平台,鱼香肉丝；水煮肉片；干锅土豆
家属区家常菜馆,南校区家属区1号楼底商,11:00-21:00,双平台,西红柿炒鸡蛋；青椒肉丝；红烧肉；大盘鸡
老西安面馆(家属区店),南校区家属区3号楼底商,10:30-21:30,双平台,油泼面；臊子面；biangbiang面；肉夹馍
川味小厨(家属区店),南校区家属区5号楼底商,11:00-21:00,双平台,麻婆豆腐；鱼香肉丝；水煮肉片；干锅土豆
鲜果时光(家属区店),南校区家属区2号楼底商,10:00-22:00,双平台,鲜榨西瓜汁；芒果汁；水果捞；各类果切
便民早餐店(家属区店),南校区家属区1号楼底商,06:30-10:00,双平台,豆浆；油条；包子；茶叶蛋；胡辣汤
烧烤大排档(家属区店),南校区家属区南门西侧,17:00-23:00,双平台,烤羊肉串；烤鸡翅；烤茄子；炒面
黄焖鸡米饭(家属区店),南校区家属区4号楼底商,10:30-21:30,双平台,小份黄焖鸡；中份黄焖鸡；配菜
兰州拉面(家属区店),南校区家属区南门东侧,07:00-21:30,双平台,兰州牛肉面；牛肉炒面；牛肉盖浇饭；大盘鸡
大碗小碗火锅便当,南校区家属区1号楼底商,11:00-21:00,双平台,单人火锅便当；双人套餐；配菜
初味柠檬鱼米饭,南校区家属区2号楼底商,10:30-21:30,双平台,招牌柠檬鱼米饭；番茄鱼米饭；酸菜鱼米饭
派克兄弟汉堡,南校区家属区3号楼底商,10:00-22:00,双平台,牛肉汉堡；炸鸡套餐；薯条
麻辣面对面精品重庆小面,南校区家属区4号楼底商,10:30-21:30,双平台,重庆小面；豌杂面；牛肉面
胖子小炒(朵颐餐厅),南校区家属区5号楼底商,11:00-21:00,双平台,青椒肉丝；西红柿炒鸡蛋；水煮肉片
橙意满满鲜榨果汁零食店,南校区家属区2号楼底商,10:00-22:00,双平台,鲜榨西瓜汁；芒果汁；水果捞；各类零食
咪一咻创意鲜饮(西电店),南校区家属区3号楼底商,10:00-22:00,双平台,珍珠奶茶；柠檬水；草莓圣代
老潼关肉夹馍(家属区店),南校区家属区南门东侧,07:30-21:30,双平台,腊汁肉夹馍；凉皮；冰峰；套餐
蜀渝蜀二川菜(家属区店),南校区家属区5号楼底商,11:00-21:00,双平台,鱼香肉丝；水煮肉片；干锅土豆
科苑酒店餐厅,西电科大家属院东南院38号楼北侧,11:00-21:00,双平台,炒菜；盖浇饭；包间可预订
拾之味特色拌饭,海棠餐厅一层03号档口,11:00-13:00 17:00-19:00,双平台,卤肉饭；金枪鱼饭；照烧鸡扒饭；香辣牛腩饭
饸饹面,海棠餐厅一层05号档口,11:00-13:00 17:00-19:00,双平台,干拌肉臊面；红烧牛肉面；西红柿鸡蛋面
大福焖面,海棠餐厅一层09号档口,11:00-13:00 17:00-19:00,双平台,素小炒焖面；肉末烧豆角焖面；土豆烧肉焖面
营养套餐,海棠餐厅一层06号档口,11:00-13:00 17:00-19:00,双平台,一荤两素；两荤一素；三荤一素
东北砂锅面,海棠餐厅一层37号档口,11:00-13:00 17:00-19:00,双平台,砂锅面；砂锅米线；砂锅土豆粉
小碗菜 锅巴饭,海棠餐厅一层38号档口,11:00-13:00 17:00-19:00,双平台,小碗菜；锅巴饭
焖鸡拌饭,海棠餐厅二层06号档口,11:00-13:00 17:00-19:00,双平台,黄焖鸡拌饭；黄焖排骨拌饭
辣椒炒肉,海棠餐厅二层16-17号档口,11:00-13:00 17:00-19:00,双平台,辣椒炒肉盖浇饭；小炒黄牛肉盖浇饭
笼王蒸面,海棠餐厅二层20号档口,11:00-13:00 17:00-19:00,双平台,招牌蒸面；牛肉蒸面；鸡蛋蒸面
北大仓麻辣烫,海棠餐厅二层24号档口,11:00-13:00 17:00-19:00,双平台,素菜；荤菜；汤底
营养快餐,丁香餐厅二层03-04号档口,11:00-13:00 17:00-19:00,双平台,一荤两素；两荤一素；三荤一素
昆吉双拼饭,丁香餐厅二层13号档口,11:00-13:00 17:00-19:00,双平台,鸡排+烤肉双拼；牛肉+鸡肉双拼
小炒鸡拌饭,丁香餐厅二层14号档口,11:00-13:00 17:00-19:00,双平台,小炒鸡拌饭；小炒牛肉拌饭
大飞炖肉饭,丁香餐厅二层17号档口,11:00-13:00 17:00-19:00,双平台,红烧肉饭；炖排骨饭；炖牛肉饭
羊杂面,丁香餐厅二层19号档口,11:00-13:00 17:00-19:00,双平台,羊杂面；羊汤面；牛肉汤面
煲仔饭,丁香餐厅二层07号档口,11:00-13:00 17:00-19:00,双平台,广式腊肠煲仔饭；腊味双拼煲仔饭
`;

export const communityPlatformVendors: FoodVendor[] = buildCommunityPlatformVendors(rawRows);

export const communityPlatformStats = {
  vendorCount: communityPlatformVendors.length,
  dishCount: communityPlatformVendors.reduce((sum, vendor) => sum + vendor.items.length, 0),
};

function buildCommunityPlatformVendors(rows: string): FoodVendor[] {
  return rows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRow)
    .filter((row): row is ParsedRow => Boolean(row))
    .filter((row) => !shouldSkipVendor(row.name, row.location))
    .map(rowToVendor)
    .filter((vendor) => vendor.items.length > 0);
}

interface ParsedRow {
  name: string;
  location: string;
  hours: string;
  platform: string;
  menuText: string;
}

function parseRow(line: string): ParsedRow | null {
  const parts = line.split(",");
  if (parts.length < 5) return null;
  const [name, location, hours, platform, ...menuParts] = parts;
  return {
    name: name.trim(),
    location: location.trim(),
    hours: hours.trim(),
    platform: platform.trim(),
    menuText: menuParts.join(",").trim(),
  };
}

function rowToVendor(row: ParsedRow): FoodVendor {
  const area = inferArea(row.location);
  const floor = inferFloor(row.location);
  const windowNo = inferWindowNo(row.location);
  const channel = area.includes("餐厅") ? "canteen" : "nearby";
  const supportedChannels = inferSupportedChannels(channel, row.platform);
  const name = cleanVendorName(row.name);
  const dishNames = normalizeDishNames(row.menuText, name);
  const tags = inferVendorTypes(`${name} ${dishNames.join(" ")}`);
  const available = inferAvailablePeriods(row.hours);
  const locationHint = [area, floor, windowNo ? `${windowNo}号档口` : "", row.location].filter(Boolean).join(" · ");

  return {
    id: `platform-${slugify(area)}-${slugify(name)}`,
    name: area.includes("餐厅") && windowNo ? `${area} ${windowNo}# · ${name}` : name,
    campus: "south",
    channel,
    supportedChannels,
    area,
    floor,
    windowNo,
    windowName: name,
    locationHint,
    distanceMinutes: distanceForArea(area),
    deliveryMinutes: supportedChannels.includes("delivery") ? 25 : undefined,
    tags,
    source,
    sourceTitle,
    updatedAt,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
    items: dishNames.map((dishName, index) =>
      rowToItem({
        dishName,
        vendorName: name,
        vendorTypes: tags,
        area,
        floor,
        windowNo,
        locationHint,
        hours: row.hours,
        platform: row.platform,
        available,
        index,
      }),
    ),
  };
}

function rowToItem({
  dishName,
  vendorName,
  vendorTypes,
  area,
  floor,
  windowNo,
  locationHint,
  hours,
  platform,
  available,
  index,
}: {
  dishName: string;
  vendorName: string;
  vendorTypes: FoodType[];
  area: string;
  floor?: string;
  windowNo?: string;
  locationHint: string;
  hours: string;
  platform: string;
  available: MealPeriod[];
  index: number;
}): FoodItem {
  const itemTypes = inferItemTypes(`${vendorName} ${dishName}`, vendorTypes);
  return {
    id: `platform-${slugify(area)}-${slugify(vendorName)}-${slugify(dishName)}-${index}`,
    name: dishName,
    types: itemTypes,
    heat: inferHeat(`${vendorName} ${dishName}`),
    popularity: inferPopularity(dishName, index),
    available,
    description: `${locationHint}，${platform}，营业 ${hours}。`,
    windowNo,
    windowName: vendorName,
    locationHint,
    sourceMethod: "manual-review",
    reviewStatus: "approved",
  };
}

function shouldSkipVendor(name: string, location: string) {
  const text = `${name} ${location}`;
  return /教苑服务中心|晨光文具|便利店|百货超市|裕丰缘|马金龙|豫鑫隆|8天便利店/.test(text);
}

function cleanVendorName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[（(](?:西电|西安电子科技大学|电子科技大学|西电南校区|西电南校|西电店|西综店|家属区店|竹园一路店|西电老综店|西电新校区|电子科大店|教苑服务中心店|西电西综美食坊店)[^）)]*[）)]/g, "")
    .replace(/[（(]西安电子科技大学店[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeDishNames(menuText: string, vendorName: string) {
  const dishes = menuText
    .split(/[；;]/)
    .map(cleanDishName)
    .filter(Boolean)
    .filter((dishName) => !isSideOrGenericDish(dishName));
  const unique = Array.from(new Set(dishes));
  if (unique.length > 0) return unique;
  const fallback = fallbackDishName(vendorName);
  return fallback ? [fallback] : [];
}

function cleanDishName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/人均?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?元(?:\/(?:斤|份|串|个|100g))?/g, "")
    .replace(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?元(?:\/(?:斤|份|串|个|100g))?/g, "")
    .replace(/\d+(?:\.\d+)?-\d+(?:\.\d+)?元/g, "")
    .replace(/[（(][^）)]*(?:原|新开业|店)[^）)]*[）)]/g, "")
    .replace(/^\s*(?:招牌|经典|原味)\s*/, (match) => (match.includes("原味") ? "原味" : ""))
    .replace(/\s+/g, "")
    .replace(/[：:，,。]+$/g, "")
    .trim();
}

function isSideOrGenericDish(name: string) {
  if (!name || name.length < 2) return true;
  if (/^(配菜|素菜|荤菜|汤底|加面|加炸蛋|加肥肠|米饭|拌面|烤肠|酸梅汤|冰峰|可乐|薯条|鸡米花|包间可预订|各类零食)$/.test(name)) return true;
  if (/^(各类|炒菜|面食|小炒|中份|双人餐|套餐)$/.test(name)) return true;
  if (/配菜|素菜|荤菜|汤底|包间/.test(name)) return true;
  if (/^各类/.test(name)) return true;
  return false;
}

function fallbackDishName(vendorName: string) {
  if (/麻辣烫|麻辣拌|冒菜|麻辣香锅|鸡公煲|煲王/.test(vendorName)) return vendorName.replace(/餐饮店|店$/g, "");
  if (/美食坊餐厅|同州食坊|科苑酒店餐厅/.test(vendorName)) return vendorName;
  return "";
}

function inferArea(location: string) {
  if (location.includes("海棠餐厅一层")) return "海棠一层餐厅";
  if (location.includes("海棠餐厅二层")) return "海棠二层餐厅";
  if (location.includes("丁香餐厅二层")) return "丁香二层餐厅";
  if (/家属区|家属院/.test(location)) return "家属区";
  if (/老综合楼|东综合楼/.test(location)) return "老综";
  return "新综";
}

function inferFloor(location: string) {
  if (/负一层/.test(location)) return "负一层";
  if (/[一1]层|一楼|1层|X-1|x-1|西街1层|东街1层|d-1/.test(location)) return "一层";
  if (/[二2]层|二楼|2层|X-2|x-2|d-2/.test(location)) return "二层";
  return undefined;
}

function inferWindowNo(location: string) {
  const match = location.match(/(?:一层|二层)?([0-9]{1,2}(?:-[0-9]{1,2})?)号档口/);
  return match?.[1];
}

function inferSupportedChannels(primary: Channel, platform: string): Channel[] {
  if (primary === "canteen") return ["canteen"];
  if (platform.includes("仅堂食")) return [primary];
  return Array.from(new Set([primary, "delivery"]));
}

function inferAvailablePeriods(hours: string): MealPeriod[] {
  const periods = new Set<MealPeriod>();
  const ranges = [...hours.matchAll(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g)].map((match) => ({
    start: Number(match[1]) + Number(match[2]) / 60,
    end: Number(match[3]) + Number(match[4]) / 60,
  }));
  for (const range of ranges) {
    const end = range.end < range.start ? range.end + 24 : range.end;
    if (range.start < 10 && end > 6) periods.add("breakfast");
    if (range.start < 14 && end > 10.5) periods.add("lunch");
    if (range.start < 20.5 && end > 16.5) periods.add("dinner");
    if (end >= 22.5 || range.end < range.start) periods.add("late");
  }
  return periods.size ? [...periods] : ["lunch", "dinner"];
}

function inferVendorTypes(text: string): FoodType[] {
  return inferItemTypes(text, []);
}

function inferItemTypes(text: string, fallback: FoodType[]): FoodType[] {
  const types = new Set<FoodType>(fallback);
  if (/咖啡|奶茶|烧仙草|果汁|柠檬|鲜饮|蜜雪|书亦|益禾堂|拿铁|美式|奶绿|果茶|圣代|水果捞|酸梅汤/.test(text)) types.add("drink");
  if (/汉堡|华莱士|迈德思克|0090|派克|意面|三明治|寿司/.test(text)) types.add("western");
  if (/饭|盖浇|黄焖鸡|烤肉饭|拌饭|煲仔|便当|炒鸡|小炒|川菜|湘菜|鸡公煲|炒菜|大盘鸡|煲|米饭/.test(text)) types.add("rice");
  if (/面|粉|米线|拉面|泡馍|肉夹馍|凉皮|螺蛳粉|渔粉|小面|蒸面|焖面|馍/.test(text)) types.add("noodle");
  if (/鸡排|鸭脖|辣条|花甲|烧烤|串|饭团|手抓饼|小吃|包子|油条|蒸饺|豆皮|鸭翅|鸡翅/.test(text)) types.add("snack");
  if (/辣|麻|川|湘|椒|冒菜|香锅|螺蛳|水煮|鸡公煲|酸辣/.test(text)) types.add("spicy");
  if (/粥|汤|番茄|小米|豆浆|清汤|原汤/.test(text)) types.add("light");
  if (/牛|羊|鸡|鸭|肉|鱼|排骨|肥牛|黄牛|五花|鸡蛋|培根|虾|花甲|猪|肠/.test(text)) types.add("protein");
  if (/油泼|臊子|biang|泡馍|老潼关|老陕|肉夹馍|同州|凉皮|胡辣汤/.test(text)) types.add("local");
  if (!types.size) types.add("rice");
  return [...types];
}

function inferHeat(text: string): HeatLevel {
  if (/麻辣|重辣|香辣|辣椒|冒菜|香锅|水煮|螺蛳|剁椒/.test(text)) return "medium";
  if (/泡椒|藤椒|椒麻|酸辣|辣条|川|湘|鸡公煲/.test(text)) return "mild";
  return "none";
}

function inferPopularity(_dishName: string, index: number) {
  return Math.max(0.68, 0.9 - index * 0.04);
}

function distanceForArea(area: string) {
  if (area === "家属区") return 15;
  if (area.includes("餐厅")) return 7;
  return 9;
}

function slugify(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
