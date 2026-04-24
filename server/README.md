# Netclass Sidekick — 服务端（Cloudflare Workers）

## 本地开发

```bash
npm install
npm run dev          # wrangler dev 监听 http://localhost:8787
curl http://localhost:8787/healthz
```

首次本地 dev 需要先跑 D1 迁移：
```bash
npm run db:migrate:local
```

## 部署到 Cloudflare（首次）

```bash
npx wrangler login                              # 浏览器 OAuth 登录
npx wrangler d1 create netclass-db              # 创建 D1 实例 → 拿 database_id
# 把 database_id 填进 wrangler.toml
npx wrangler r2 bucket create netclass-storage  # 创建 R2 bucket
npx wrangler secret put JWT_SECRET              # 交互式输入 ≥32 字符的随机串
npx wrangler secret put ADMIN_KEY               # 再输入另一个 ≥32 字符的随机串
npm run db:migrate:remote
npm run deploy
```

部署完成后，在 cc-worker 侧的 `~/.netclass-drain.env` 写：
```
NETCLASS_SERVER=https://netclass-sidekick.<你的子域>.workers.dev
NETCLASS_ADMIN_KEY=<刚才 secret put 的同一个值>
```

## 端点一览

- `GET  /healthz` — 健康检查
- `POST /auth` — 卡密换 JWT
- `POST /answer` — 题目查询（命中 / 待处理）
- `POST /contribute` — 用户回传答案
- `GET  /ota/version` — 客户端检查更新
- `GET  /ota/script` — 下载最新的 `.user.js`
- `GET  /admin/pending` — drain 拉队列（需 X-Admin-Key）
- `POST /admin/submit` — drain 写答案（需 X-Admin-Key）

完整协议合约：`../docs/PROTOCOL.md`

## 测试

```bash
npm test              # vitest 跑 integration 测试（miniflare 模拟 D1/R2）
npm run typecheck     # tsc --noEmit
```
