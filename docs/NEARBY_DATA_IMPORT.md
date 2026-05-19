# 综合楼、家属区商户候选导入

这个工具用于把综合楼、家属区、周边外卖商户整理成“待审核候选”。它不会直接修改正式推荐池，原因是地图 POI 只能证明“地图上出现过这个店”，不能证明当前还营业、菜单准确，外卖平台菜单也需要平台或商户授权。

## 运行

无 Key 探测：

```bash
npm run data:nearby:probe
```

输出：

- `data/nearby-poi/nearby-poi-candidates.json`
- `data/nearby-poi/nearby-poi-candidates.csv`
- `data/nearby-poi/nearby-poi-report.json`

## 可接入的数据源

- OpenStreetMap Overpass：无需 Key，可补楼宇和少量公开 POI，但楼内档口覆盖很弱。
- 高德地图 Web 服务：设置 `AMAP_WEB_SERVICE_KEY` 或 `GAODE_WEB_SERVICE_KEY` 后可用周边搜索拉取餐饮 POI。
- 百度地图 Place API：设置 `BAIDU_MAP_AK` 或 `BAIDU_LBS_AK` 后可用地点检索拉取餐饮 POI。
- 公开学生资料：项目内置了少量公开学生手册/博客提到的综合楼、家属区候选，只作为低置信度待审核线索。

## 高德/百度 Key

```bash
AMAP_WEB_SERVICE_KEY=你的key npm run data:nearby:import
BAIDU_MAP_AK=你的ak npm run data:nearby:import
```

两个 Key 都设置时会合并去重。

## 美团、饿了么

美团和饿了么的完整店铺/菜单数据不能像地图 POI 一样公开拉取。合理路径是：

- 商户自己提供菜单或授权导出。
- 通过美团/饿了么开放平台，以合作方或商户授权方式接入。
- 学生上传门头和菜单照片，管理员审核后入库。

不要绕过平台访问控制抓取外卖页面或非公开接口；这样不稳定，也不适合开源项目让别人部署。

## 本次探测结论

2026-05-17 在未配置地图 Key 的情况下运行 `npm run data:nearby:probe`：

- 公开学生资料得到 15 条低置信度候选，集中在老综、新综、家属区。
- OpenStreetMap/Overpass 能确认新综合楼、老综合楼位置，但楼内餐饮档口覆盖不足；过滤掉海棠/竹园等食堂后，未得到可用综合楼商户。
- 高德返回 `INVALID_USER_KEY`，百度返回 `AK参数不存在`，说明需要各自平台 Key。
- 美团 H5 公开页只能拿到客户端壳页面；完整店铺和菜单需要技术合作中心或商户授权。
- 饿了么开放平台文档可访问，但商户、菜单类数据需要开放平台接入和授权。
