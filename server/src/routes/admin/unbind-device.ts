// POST /admin/unbind-device
//
// 解绑某卡密的设备绑定。用于：
//   - 用户换设备（卖了旧手机 / 重装系统 / 测试时绑超 3 台）
//   - 清掉某可疑设备（盗用预防）
//
// Body（cardkey / cardkey_hash 二选一）:
//   {
//     "cardkey":            "NSK-XXXXXXXX-XXXXXXXX",  // 明文，服务端会算 hash
//     "cardkey_hash":       "<sha256 hex>",            // 或直接给 hash
//     "device_fingerprint": "<fp>",                    // 可选；不传 = 清空全部
//   }
//
// Response:
//   { user_id, plan, before: number, after: number, removed: string[] }
//
// 鉴权：X-Admin-Key（同 admin/submit）

import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin, sha256Hex } from '../../lib/auth';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

route.post('/', async (c) => {
  const body = await c.req.json<{
    cardkey?: string;
    cardkey_hash?: string;
    device_fingerprint?: string;
  }>();

  // 解析 cardkey_hash
  let cardkey_hash = body.cardkey_hash?.trim();
  if (!cardkey_hash && body.cardkey) {
    cardkey_hash = await sha256Hex(body.cardkey.trim());
  }
  if (!cardkey_hash) {
    return c.json(
      { error: { code: 'missing_fields', message: '需要 cardkey 或 cardkey_hash' } },
      400,
    );
  }

  // 找用户
  const user = await c.env.DB.prepare(
    'SELECT id, plan, bound_devices FROM users WHERE cardkey_hash = ?',
  )
    .bind(cardkey_hash)
    .first<{ id: string; plan: string; bound_devices: string | null }>();

  if (!user) {
    return c.json({ error: { code: 'not_found', message: '该卡密未注册' } }, 404);
  }

  const before: string[] = user.bound_devices ? JSON.parse(user.bound_devices) : [];
  let after: string[];
  let removed: string[];

  if (body.device_fingerprint) {
    // 精确解绑某一个
    const target = body.device_fingerprint;
    if (!before.includes(target)) {
      return c.json({
        user_id: user.id,
        plan: user.plan,
        before: before.length,
        after: before.length,
        removed: [],
        note: 'device_fingerprint 不在已绑列表中（idempotent no-op）',
      });
    }
    after = before.filter((fp) => fp !== target);
    removed = [target];
  } else {
    // 清空全部
    after = [];
    removed = before;
  }

  await c.env.DB.prepare('UPDATE users SET bound_devices = ? WHERE id = ?')
    .bind(JSON.stringify(after), user.id)
    .run();

  return c.json({
    user_id: user.id,
    plan: user.plan,
    before: before.length,
    after: after.length,
    removed,
  });
});

export default route;
