import { Hono } from 'hono';
import type { Env } from '../index';

const route = new Hono<{ Bindings: Env }>();

// GET /ota/version
// 客户端启动时拉最新版本号
route.get('/version', async (c) => {
  // 从 R2 读 ota/latest.meta.json（运维发版时写入）
  const meta = await c.env.STORAGE.get('ota/latest.meta.json');
  if (!meta) {
    return c.json({
      latest: '0.1.0-alpha',
      min_supported: '0.1.0-alpha',
      download_url: new URL('/ota/script', c.req.url).toString(),
      sha256: null,
      signature: null,
      force_update: false,
      changelog: 'initial alpha',
    });
  }
  const metaJson = await meta.json();
  return c.json(metaJson);
});

// GET /ota/script
// R2 直出最新 .user.js
route.get('/script', async (c) => {
  const obj = await c.env.STORAGE.get('ota/latest.user.js');
  if (!obj) {
    return c.text('Script not yet published', 404);
  }
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
});

export default route;
