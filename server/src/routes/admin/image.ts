// GET /admin/image/:hash
//
// drain worker 取已存的合成图（routes/answer.ts 写进 STORAGE 的 stitched/<hash>.png）。
// 鉴权 X-Admin-Key（同其他 admin 路由）。
//
// 200 → PNG bytes
// 404 → 图不在
// 503 → STORAGE 未启用（Phase 0 disable 时）

import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin } from '../../lib/auth';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

route.get('/:hash', async (c) => {
  const hash = c.req.param('hash');
  if (!/^[0-9a-f]{16,}$/i.test(hash)) {
    return c.json({ error: { code: 'bad_hash', message: 'hash 必须 hex' } }, 400);
  }

  if (!c.env.STORAGE) {
    return c.json(
      {
        error: {
          code: 'storage_disabled',
          message: '服务端 STORAGE 未启用（DISK_STORAGE_PATH=__disabled__？）',
        },
      },
      503,
    );
  }

  const key = `stitched/${hash}.png`;
  const obj = await c.env.STORAGE.get(key);
  if (!obj) {
    return c.json({ error: { code: 'not_found', message: `${key} 不存在` } }, 404);
  }

  // R2 / DiskStorage 都返回 { body, ... }；R2 是 ReadableStream / arrayBuffer()，
  // DiskStorage 我们包成了 { body: Uint8Array }。两边都走 obj.body 取字节。
  const body =
    'arrayBuffer' in obj && typeof (obj as { arrayBuffer?: unknown }).arrayBuffer === 'function'
      ? new Uint8Array(await (obj as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer())
      : ((obj as unknown as { body: Uint8Array }).body);

  // 拷贝到独立 ArrayBuffer 让 TS Response 类型满意；运行时一回事
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Response(ab, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=86400',
    },
  });
});

export default route;
