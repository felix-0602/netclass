// Netclass Sidekick — Cloudflare Workers entry
// 协议合约：docs/PROTOCOL.md

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoute from './routes/auth';
import answerRoute from './routes/answer';
import contributeRoute from './routes/contribute';
import otaRoute from './routes/ota';
import adminPendingRoute from './routes/admin/pending';
import adminSubmitRoute from './routes/admin/submit';

export interface Env {
  DB: D1Database;
  /** R2 bucket — Phase 0 可选。未绑定时数学题合成图和 OTA 脚本分发会降级 */
  STORAGE?: R2Bucket;
  /** STORAGE bucket 的公共访问前缀（pub-<id>.r2.dev），可选 */
  STORAGE_PUBLIC_BASE?: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
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

// 用户路由
app.route('/auth', authRoute);
app.route('/answer', answerRoute);
app.route('/contribute', contributeRoute);
app.route('/ota', otaRoute);

// 管理员路由
app.route('/admin/pending', adminPendingRoute);
app.route('/admin/submit', adminSubmitRoute);

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
