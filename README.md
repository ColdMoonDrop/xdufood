# 西电今天吃什么

面向西安电子科技大学学生的“今天吃什么”推荐应用。学生选择校区、餐别、堂食/外卖、地点、主类别、口味倾向，以及素食/清真等需求后，系统会从西电后勤公众号正文菜单和审核后的学生共建数据里推荐合适档口与菜品。

当前仓库只维护网页服务器部署链路。早期手机 / Termux 部署工具已从仓库移除，不再作为正式发布方案。

## 功能概览

- 学生端移动优先推荐界面：餐别、校区、堂食/外卖、堂食地点多选、主类别单选、口味倾向和加分偏好。
- 真实食堂数据：内置西电后勤公众号公开正文菜单整理数据，不展示历史价格。
- 学生共建：南校区老综、新综、家属区和外卖商家可由学生提交，管理员审核后进入推荐池。
- 后台审核：支持查看反馈、新增或修订商家与菜品、隐藏错误数据。
- 推荐规则：结合校区、餐别、地点、标签、避雷项、素食/清真硬约束和轮换随机性，避免每顿重复。
- 数据边界：测试虚拟商家已从正式推荐池移除，非食堂商家不会未经审核进入推荐。

## 本地开发

```bash
npm install
npm run dev
```

默认开发地址是 `http://127.0.0.1:5173/`。

## 生产运行

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

启动后访问：

- 前台：`http://服务器IP:8080/`
- 后台：`http://服务器IP:8080/admin`
- 健康检查：`http://服务器IP:8080/api/health`

部署到公网前请务必修改 `.env` 里的 `ADMIN_TOKEN`。完整部署说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## Docker 部署

```bash
ADMIN_TOKEN="$(openssl rand -hex 32)" docker compose up -d --build
```

学生提交和审核数据保存在 Docker volume `xdufood-data`。更多 systemd、Nginx、HTTPS 和备份说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 常用脚本

```bash
npm run build          # 类型检查并构建前端
npm test               # 运行前端/推荐规则测试
npm run data:xdu:test  # 运行食堂数据解析测试
npm start              # 启动生产 Node 服务
```

## GitHub Pages 前端托管

项目也可以采用“静态前端 + 独立 API 后端”的方式部署。构建静态前端时设置后端地址：

```bash
VITE_API_BASE=https://api.example.com npm run build
```

如果本地需要生成 GitHub Pages 构建，也请显式传入后端地址，不再从旧手机配置自动推断：

```bash
pwsh -File tools/build-github-pages.ps1 -ApiBase https://api.example.com -Base /xdufood/
```

仓库已包含 `.github/workflows/pages.yml`，可以在 GitHub Pages 使用 Actions 自动发布前端。后端仍需部署 `server/site-server.mjs`，用于学生提交、后台审核和菜单照片数据。

如果使用 GitHub Actions 发布 Pages，请在仓库 `Settings` → `Secrets and variables` → `Actions` → `Variables` 中添加 `VITE_API_BASE`，值为你的后端 HTTPS 地址。未设置时，静态页面仍可展示内置食堂数据，但提交反馈和后台审核接口不可用。

## 食堂数据来源

项目接入公开的西电后勤公众号文章，并优先使用公众号正文直接提取的窗口与菜品：

- `tools/xdu-canteen-import/articles.json`：维护海棠、丁香、竹园、西区、东区、西军电餐厅的公开文章链接。
- `data/xdu-canteen/export/xdu-canteen-wechat-text-window-dishes.csv`：公众号正文直接提取的窗口与菜品。
- `tools/xdu-canteen-import/generate_wechat_text_data.py`：把正文提取 CSV 转成前端推荐数据，并过滤米饭、煎蛋、烤肠等配菜单品。
- `src/data/xduWechatTextCanteens.generated.ts`：前端食堂数据。
- `src/data/catalog.ts`：正式推荐池入口。

OCR 复核工具仍保留，适合后续继续从菜单图片补充数据：

```powershell
npm run data:xdu:setup
npm run data:xdu:fetch
npm run data:xdu:ocr
npm run data:xdu:review-ui
```

打开 `http://127.0.0.1:8765/`，可在复核台对照图片、OCR 文字框、窗口和价格进行修订。复核完成后运行：

```powershell
npm run data:xdu:generate
```

## 合规建议

综合楼、家属区和外卖商家建议通过以下方式加入：

- 学生现场提交并由管理员审核。
- 商户授权导出的菜单和价格表。
- 学校后勤/餐饮服务中心维护的公开台账。
- CSV/XLSX 人工导入。

不建议直接爬取第三方外卖平台页面或绕过平台访问控制。

仓库提供了一个综合楼/家属区候选商户探测工具，用于把地图 POI 和公开学生资料整理成待审核线索：

```bash
npm run data:nearby:probe
```

如需接入高德或百度地图 POI，请参考 [综合楼、家属区商户候选导入](docs/NEARBY_DATA_IMPORT.md) 配置对应 Key。生成结果只进入 `data/nearby-poi/`，不会自动进入正式推荐池。

学生或管理员提供的菜单截图、外卖平台截图、店内菜单照片可以走本地 OCR 流程，详见 [菜单截图本地 OCR](docs/MENU_SCREENSHOT_OCR.md)：

```bash
npm run data:menu:screenshot -- --submissions default
```

## 业务规则

- `早餐` 属于餐别，不作为“想吃”标签。
- `夜宵` 只依赖菜品真实或已审核的 `late` 时段。
- `素食`、`清真` 是硬约束，不与“想吃”标签重复。
- 米饭套餐、面/粉、小吃、西式、饮品甜点作为主类别单选。

## 许可证

本项目使用 [MIT License](LICENSE) 开源。
