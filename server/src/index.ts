// Netclass Sidekick — Hono app 定义
// 运行时：Node（src/server.ts）为主；wrangler 部署已弃用（保留 wrangler.toml 历史）
// 协议合约：docs/PROTOCOL.md

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoute from './routes/auth';
import answerRoute from './routes/answer';
import contributeRoute from './routes/contribute';
import otaRoute from './routes/ota';
import adminPendingRoute from './routes/admin/pending';
import adminSubmitRoute from './routes/admin/submit';
import adminUnbindRoute from './routes/admin/unbind-device';
import adminImageRoute from './routes/admin/image';
import adminCleanupRoute from './routes/admin/cleanup';
import adminVerifyAnswerRoute from './routes/admin/verify-answer';
import adminDashboardHtml from './routes/admin/dashboard.html';
import adminApiStats from './routes/admin/api-stats';
import adminApiUsers from './routes/admin/api-users';
import adminApiCardkeys from './routes/admin/api-cardkeys';
import adminApiDeepseek from './routes/admin/api-deepseek';
import type { D1LikeDatabase } from './lib/db-sqlite-adapter';

/**
 * 题库服务端配置。生产由 src/server.ts 构造，测试里由 createTestEnv 注入。
 *
 * 类型用 `any` 别名（而不是 `D1Database | D1LikeDatabase`）是为了让已有
 * 路由代码（用 `c.env.DB.prepare(...)`）不改一行也能跑。两者都有相同
 * 子集 API（prepare/bind/first/all/run/batch），运行时行为一致。
 */
export interface Env {
  /** D1 or D1-like (better-sqlite3 wrapper)。运行时鸭子类型 */
  DB: D1LikeDatabase;
  /**
   * R2 bucket — Phase 0 可选。类型用 R2Bucket（@cloudflare/workers-types
   * 作为 devDep 提供）让 routes/answer.ts 等 STORAGE 调用点类型检查通过。
   * 运行时：Node 环境下 createEnv() 设为 undefined，所有使用路径都有 if(STORAGE) 守护。
   */
  STORAGE?: R2Bucket;
  /** STORAGE bucket 的公共访问前缀，可选 */
  STORAGE_PUBLIC_BASE?: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
  /** DeepSeek API key — 服务端实时作答，缓存未命中时自动调 */
  DEEPSEEK_API_KEY: string;
  PROTOCOL_VERSION: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS：客户端跨域调用
app.use(
  '*',
  cors({
    origin: '*', // 生产可收窄到白名单平台
    allowMethods: ['GET', 'POST'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Client-Version',
      'X-Device-Fingerprint',
      'X-Admin-Key',
    ],
    maxAge: 86400,
  }),
);

// 健康检查
app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    protocol: c.env.PROTOCOL_VERSION,
    time: new Date().toISOString(),
  }),
);

// OTA 用户脚本分发（直接读本地文件，无需 R2）
app.get('/ota/script', async (c) => {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const scriptPath = path.join(process.env.SCRIPTS_DIR ?? 'scripts', 'latest.user.js');
    const content = fs.readFileSync(scriptPath, 'utf8');
    return new Response(content, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  } catch {
    // fallback to R2 if available
    if ((c.env as any).STORAGE) {
      const obj = await (c.env as any).STORAGE.get('ota/latest.user.js');
      if (obj) return new Response(obj.body, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }
    return c.text('Script not available', 404);
  }
});

// 用户路由
app.route('/auth', authRoute);
app.route('/answer', answerRoute);
app.route('/contribute', contributeRoute);
app.route('/ota', otaRoute);

// 管理员路由
app.route('/admin/pending', adminPendingRoute);
app.route('/admin/submit', adminSubmitRoute);
app.route('/admin/unbind-device', adminUnbindRoute);
app.route('/admin/image', adminImageRoute);
app.route('/admin/cleanup-broken', adminCleanupRoute);
app.route('/admin/verify-answer', adminVerifyAnswerRoute);

// Admin Dashboard（HTML 页面 + API，全部需要 X-Admin-Key）
import { requireAdmin } from './lib/auth';
const adminApi = new Hono<{ Bindings: Env }>();
adminApi.use('*', requireAdmin);
adminApi.route('/stats', adminApiStats);
adminApi.route('/users', adminApiUsers);
adminApi.route('/cardkeys', adminApiCardkeys);
adminApi.route('/deepseek-usage', adminApiDeepseek);

app.get('/admin/dashboard', (c) => c.html(adminDashboardHtml));
app.route('/admin/api', adminApi);

// 404
app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route' } }, 404));

// 500 兜底
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'internal_error', message: err.message } },
    500,
  );
});

export default app;
