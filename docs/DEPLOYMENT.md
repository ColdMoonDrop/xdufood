# 服务器部署指南

这个项目可以作为一个普通 Node.js 服务部署：前端静态文件由 Vite 构建，`server/site-server.mjs` 同时提供页面、学生提交 API 和管理后台 API。

## 环境要求

- Linux 服务器或支持 Node.js 的云主机
- Node.js 20 或更高版本
- npm
- 可选：Nginx / Caddy / Cloudflare Tunnel / Docker

## 直接部署

```bash
git clone https://github.com/ColdMoonDrop/xdufood.git
cd xdufood
npm ci
cp .env.example .env
```

编辑 `.env`，至少把 `ADMIN_TOKEN` 改成强随机字符串。然后构建并启动：

```bash
npm run build
npm start
```

默认访问地址：

- 前台：`http://服务器IP:8080/`
- 后台：`http://服务器IP:8080/admin`
- 健康检查：`http://服务器IP:8080/api/health`

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | 监听端口 |
| `SITE_DIR` | `dist` | 前端构建产物目录 |
| `DATA_DIR` | `server-data` | 学生提交和审核修订数据目录 |
| `ADMIN_TOKEN` | 空 | 后台管理员令牌；公网部署必须设置 |
| `MAX_BODY_BYTES` | `5242880` | 单次提交 JSON 最大体积 |
| `MAX_SUBMISSION_ATTACHMENTS` | `3` | 单次反馈最多图片数 |
| `MAX_ATTACHMENT_DATA_URL_BYTES` | `1048576` | 单张图片 base64 最大体积 |
| `POST_RATE_WINDOW_MS` | `600000` | 提交限流窗口 |
| `POST_RATE_LIMIT` | `20` | 单个来源在窗口内最多提交数 |

## systemd 常驻运行

假设项目位于 `/opt/xdufood`：

```ini
[Unit]
Description=XDU Food Oracle
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/xdufood
EnvironmentFile=/opt/xdufood/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
User=xdufood

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/xdufood.service` 后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now xdufood
sudo systemctl status xdufood
```

## Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

建议再用 Certbot、Caddy 或云平台证书开启 HTTPS。

## Docker Compose

```bash
git clone https://github.com/ColdMoonDrop/xdufood.git
cd xdufood
ADMIN_TOKEN="$(openssl rand -hex 32)" docker compose up -d --build
```

数据会保存在 Docker volume `xdufood-data`。升级时：

```bash
git pull
ADMIN_TOKEN="你的原令牌" docker compose up -d --build
```

## GitHub Actions 自动部署

仓库包含 `.github/workflows/deploy-server.yml`，推送到 `main` 后会通过受限 SSH key 触发服务器部署。需要在 GitHub 仓库 `Settings` → `Secrets and variables` → `Actions` 中配置：

| Secret | 说明 |
| --- | --- |
| `XDUFOOD_DEPLOY_HOST` | 服务器 IP 或域名 |
| `XDUFOOD_DEPLOY_USER` | 受限部署用户 |
| `XDUFOOD_DEPLOY_PORT` | SSH 端口 |
| `XDUFOOD_DEPLOY_KEY` | 对应部署私钥内容 |

可选仓库变量：

| Variable | 默认值 | 说明 |
| --- | --- | --- |
| `XDUFOOD_HEALTH_URL` | `https://aiourstory.cn/xdufood/api/health` | 部署后健康检查地址 |

服务器端需要把部署私钥对应的公钥加入部署用户的 `~/.ssh/authorized_keys`，并限制该 key 只能执行服务器上的部署脚本。

## 更新与备份

升级代码：

```bash
git pull
npm ci
npm run build
sudo systemctl restart xdufood
```

建议定期备份 `DATA_DIR`，其中最重要的是：

- `submissions.jsonl`：学生提交与菜单照片
- `catalog-patch.json`：后台审核后的商家、菜品和隐藏项修订

## 静态前端 + 独立 API

如果前端托管在 GitHub Pages、对象存储或 CDN，而 Node 后端部署在另一台服务器，构建前端时设置：

```bash
VITE_API_BASE=https://api.your-domain.example npm run build
```

这样静态页面会把 `/api/*` 请求发到指定后端。

使用仓库自带的 GitHub Pages Actions 时，请把同一个后端地址配置为仓库变量 `VITE_API_BASE`。不要把临时隧道、管理员令牌或私人服务器地址写死到 workflow。
