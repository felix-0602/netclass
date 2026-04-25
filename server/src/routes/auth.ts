import { Hono } from 'hono';
import type { Env } from '../index';
import { signJwt } from '../lib/jwt';
import { sha256Hex } from '../lib/auth';

const route = new Hono<{ Bindings: Env }>();

// POST /auth
// { cardkey, device_fingerprint } → { jwt, expires_at, plan, month_exp, features }
route.post('/', async (c) => {
  const body = await c.req.json<{ cardkey?: string; device_fingerprint?: string }>();
  const { cardkey, device_fingerprint } = body;

  if (!cardkey || !device_fingerprint) {
    return c.json(
      { error: { code: 'missing_fields', message: 'cardkey + device_fingerprint 必填' } },
      400,
    );
  }

  const cardkey_hash = await sha256Hex(cardkey);
  const user = await c.env.DB.prepare(
    'SELECT id, plan, bound_devices, monthly_exp, is_banned FROM users WHERE cardkey_hash = ?',
  )
    .bind(cardkey_hash)
    .first<{
      id: string;
      plan: 'monthly' | 'lifetime' | 'admin';
      bound_devices: string | null;
      monthly_exp: number | null;
      is_banned: number;
    }>();

  if (!user) {
    return c.json(
      { error: { code: 'invalid_cardkey', message: '卡密无效或未开通' } },
      401,
    );
  }
  if (user.is_banned) {
    return c.json({ error: { code: 'banned', message: '卡密被封禁' } }, 403);
  }

  // 过期检查（仅月订；admin/lifetime 跳）
  const nowSec = Math.floor(Date.now() / 1000);
  if (user.plan === 'monthly' && user.monthly_exp && user.monthly_exp < nowSec) {
    return c.json(
      { error: { code: 'cardkey_expired', message: '月订已过期，请续费' } },
      401,
    );
  }

  // 设备绑定 — admin plan 跳过设备数上限（开发者 / 自用），仍记录设备但不拒绝
  const devices: string[] = user.bound_devices ? JSON.parse(user.bound_devices) : [];
  const DEVICE_LIMIT = 3;
  if (!devices.includes(device_fingerprint)) {
    if (user.plan !== 'admin' && devices.length >= DEVICE_LIMIT) {
      return c.json(
        {
          error: {
            code: 'device_limit',
            message: `此卡密已绑定 ${DEVICE_LIMIT} 个设备，联系管理员解绑或换卡密`,
          },
        },
        403,
      );
    }
    devices.push(device_fingerprint);
    await c.env.DB.prepare('UPDATE users SET bound_devices = ? WHERE id = ?')
      .bind(JSON.stringify(devices), user.id)
      .run();
  }

  // 签 JWT：7 天有效
  const exp = nowSec + 7 * 24 * 3600;
  const fp = await sha256Hex(device_fingerprint);
  const jwt = await signJwt(
    { sub: user.id, plan: user.plan, exp, fp },
    c.env.JWT_SECRET,
  );

  return c.json({
    jwt,
    expires_at: new Date(exp * 1000).toISOString(),
    plan: user.plan,
    month_exp: user.monthly_exp ? new Date(user.monthly_exp * 1000).toISOString() : null,
    features: {
      free: ['time_padder', 'task_jumper'],
      paid: ['answer_bank', 'contribute', 'dashboard'],
    },
  });
});

export default route;
