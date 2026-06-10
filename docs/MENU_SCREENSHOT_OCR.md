# 菜单截图本地 OCR

这个流程用于处理学生或管理员主动提供的菜单截图、外卖平台截图、店内菜单照片。工具只读取本地图片或本项目收到的学生反馈图片，不访问美团、饿了么，不模拟登录，不自动滑动截屏。

## 准备 OCR 环境

```bash
npm run data:xdu:setup
```

这会复用食堂菜单 OCR 的 PaddleOCR 环境。

## 处理本地图片

把截图放到：

```text
data/menu-screenshots/inbox/
```

然后运行：

```bash
npm run data:menu:screenshot -- --vendor 老综某商家 --area 老综
```

输出：

- `data/menu-screenshots/review/menu-ocr-drafts.json`
- `data/menu-screenshots/review/menu-ocr-drafts.csv`
- `data/menu-screenshots/review/menu-ocr-raw.json`

所有记录默认都是 `pending`，需要管理员人工复核后再入库。

## 处理学生反馈里的图片

如果服务器数据在本机，默认会优先读取 `server-data/xdufood.sqlite` 中的学生反馈图片；如果数据库不存在，则退回读取旧的 `server-data/submissions.jsonl`：

```bash
npm run data:menu:screenshot -- --submissions default
```

也可以指定 SQLite 或导出的 JSONL：

```bash
npm run data:menu:screenshot -- --submissions path/to/xdufood.sqlite
npm run data:menu:screenshot -- --submissions path/to/submissions.jsonl
```

## 边界

- 可以：识别你手动保存的商户菜单截图、学生上传的菜单照片、商家授权给你的菜单图片。
- 不做：自动登录美团/饿了么、绕过定位/签名/风控、批量访问页面、自动滚动截屏。
- 输出里可能包含价格字段，但学生端当前不展示价格；价格主要用于人工核验和去重。
