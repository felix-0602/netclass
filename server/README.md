# Netclass Sidekick — Server (Cloudflare Workers)

## 本地 Dev

```bash
npm install
npm run dev          # wrangler dev on http://localhost:8787
curl http://localhost:8787/healthz
```

首次本地 dev 需要跑 migrations：
```bash
npm run db:migrate:local
```

## 部署到 CF（首次）

```bash
npx wrangler login                          # 浏览器 OAuth 登录
npx wrangler d1 create netclass-db          # 创建 D1 → 拿 database_id
# 把 database_id 填进 wrangler.toml
npx wrangler r2 bucket create netclass-storage  # 创建 R2 bucket
npx wrangler secret put JWT_SECRET          # 交互式输入 32+ 字符随机字符串
npx wrangler secret put ADMIN_KEY           # 交互式输入另一个 32+ 字符随机串
npm run db:migrate:remote
npm run deploy
```

部署后 cc-worker 侧填 `~/.netclass-drain.env`：
```
NETCLASS_SERVER=https://netclass-sidekick.<your-subdomain>.workers.dev
NETCLASS_ADMIN_KEY=<刚才 secret put 的同一个值>
```

## 端点

- `GET  /healthz` — 健康检查
- `POST /auth` — 卡密换 JWT
- `POST /answer` — 题目查询（hit / pending）
- `POST /contribute` — 用户回传
- `GET  /ota/version` — 客户端检查更新
- `GET  /ota/script` — 下载最新 .user.js
- `GET  /admin/pending` — drain 拉队列 (X-Admin-Key)
- `POST /admin/submit` — drain 写答案 (X-Admin-Key)

协议合约完整版：`../docs/PROTOCOL.md`

## 测试

```bash
npm test              # vitest 跑 integration 测试（miniflare 模拟 D1/R2）
npm run typecheck     # tsc --noEmit
```
