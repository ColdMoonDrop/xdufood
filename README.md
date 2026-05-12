# 西电今天吃什么

面向西安电子科技大学学生的“今天吃什么”推荐应用。学生选择校区、预算、餐别、就餐方式、口味、辣度，以及素食/清真等需求后，系统会从西电后勤公众号导入的现有食堂数据里推荐合适档口与菜品。综合楼、家属区和外卖商家只通过学生提交与后台审核后进入推荐。

## 当前功能

- 学生端实时推荐界面：预算滑杆、餐别、校区、堂食/外卖偏好、堂食地点多选、主类别单选、口味倾向、加分偏好、辣度。
- 南校区老综、新综、家属区商家支持学生共建提交；同一商家可以标记为同时支持堂食和外卖。
- 推荐算法：综合价格、校区、供应时段、评分、热度、口味匹配、避雷项、素食/清真硬约束打分。
- 数据模型：统一表达校内堂食档口、综合楼/家属区商家、外卖店家和菜品。
- 静态推荐池已清理测试虚拟数据，只保留现有食堂数据；非食堂商家从后台审核修订进入。
- 单元测试：覆盖校区/餐别过滤、清真需求和素食需求。

## 运行

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm run build
npm test
```

## 手机服务器后台

红米 K40 / Termux 部署版会同时运行前台页面和一个轻量 Node 后端：

- 局域网前台：`http://192.168.3.85:8080/`
- 管理后台：`http://192.168.3.85:8080/admin`
- 公网临时前台/后台：以手机 `server-data/public-url.txt` 里的 Cloudflare Quick Tunnel 地址为准。

后台能力：

- 查看学生提交的纠错、新商户、新菜品反馈。
- 将反馈填入编辑表单，新增或修改商户与菜品。
- 审核老综/新综/家属区共建商家，并维护商家的支持方式、楼层、档口和菜品。
- 隐藏错误商户或菜品。
- 保存后的修订写入手机端 `~/www/xdu-food-oracle/server-data/catalog-patch.json`，前台刷新后自动生效。

管理员令牌保存在手机：

```bash
cat ~/www/xdu-food-oracle/server-data/admin-token.txt
```

手机端常用命令：

```bash
~/start-xdu-food.sh
~/start-xdu-food-public.sh
cat ~/www/xdu-food-oracle/server-data/public-url.txt
tail -f ~/www/xdu-food-oracle/server-data/site-server.log
```

## GitHub Pages 前端托管

可以把前端静态页面托管到 GitHub Pages，手机服务器继续提供 `/api/*`、学生提交、后台审核和图片数据。

本地构建 GitHub Pages 版本：

```powershell
npm run build:github-pages -- -Base /xdu-food-oracle/
```

脚本会通过 SSH 读取手机当前公网地址，注入为 `VITE_API_BASE`，并生成 `dist/404.html` 与 `dist/.nojekyll`。如果 GitHub 仓库名不是 `xdu-food-oracle`，把 `-Base` 改为 `/<仓库名>/`。如果使用 `Caltsic.github.io` 这种用户站点仓库，使用 `-Base /`。

GitHub Actions 自动部署：

1. 把项目推到 GitHub 仓库。
2. 在仓库 `Settings` → `Pages` 中选择 `GitHub Actions`。
3. 在仓库 `Settings` → `Secrets and variables` → `Actions` → `Variables` 添加：
   - `VITE_API_BASE`：手机服务器的 HTTPS 公网地址，例如当前 Cloudflare Tunnel 地址或之后的固定域名。
4. 推送到 `main` 或 `master` 后，`.github/workflows/pages.yml` 会自动构建并部署前端。

注意：如果继续使用 Cloudflare Quick Tunnel，公网地址变化后需要更新 GitHub 变量并重新运行 Pages workflow。固定域名的 Named Tunnel 更适合这种混合部署。

## 真实食堂数据接入

项目已经接入 12 篇公开的西电后勤公众号文章作为真实食堂来源索引：

- `tools/xdu-canteen-import/articles.json`：维护海棠、丁香、竹园、西区、东区、西军电餐厅的公开文章链接。
- `tools/xdu-canteen-import/xdu_canteen_importer.py`：抓取文章、下载菜单图片、调用本地 PaddleOCR、生成复核报告。
- `src/data/xduOfficialCanteens.generated.ts`：前端食堂数据，包含已复核菜品和内测待学生校准的 OCR 候选。
- `src/data/catalog.ts`：只把西电后勤公众号来源的食堂数据加入静态推荐池，不再合并校外堂食、外卖或平台模拟数据。

OCR 复核流程：

```powershell
npm run data:xdu:setup
npm run data:xdu:fetch
npm run data:xdu:ocr
```

然后启动可视化复核台：

```powershell
npm run data:xdu:review-ui
```

打开 `http://127.0.0.1:8765/`，在页面里对照图片、OCR 文字框、窗口和价格，直接修改菜名/价格/窗口并标记为 `通过` 或 `拒绝`。复核完成后可以点页面里的“生成正式推荐数据”，也可以运行：

```powershell
npm run data:xdu:generate
```

此前用于演示的校外堂食、外卖和平台模拟数据已移除。老综、新综、家属区和外卖商家需要学生提交后，由后台保存到 `catalog-patch.json` 才会进入前台推荐。

实际接入时建议使用合规数据源：

- 学校后勤/餐饮服务中心维护的档口、菜单、营业时间、价格台账。
- 商户授权导出的菜单和价格表。
- 外卖开放平台或商家后台授权 API。不要直接爬取平台页面或绕过平台访问控制。
- CSV/XLSX 人工导入，字段可先映射到 `PlatformDishRecord`。

## 后续可扩展

- 加入登录与个人偏好记忆。
- 加入“不想吃什么”避雷标签。
- 根据当前位置、上课楼宇和天气调整距离/热汤/外卖权重。
- 接入每日档口营业状态和售罄状态。
- 增加后台数据维护页，支持批量导入菜单。

## 业务规则备注

- `早餐` 属于餐别，不再作为“想吃”标签出现。
- `夜宵` 严格依赖菜品的 `available: ["late"]` 营业时段；没有真实或已审核夜宵数据时不会生成虚拟推荐。
