import { Hono } from 'hono';
import type { AdminEnv } from '../env';
import { sha256Hex, randomId } from '../lib/auth';

const route = new Hono<{ Bindings: AdminEnv }>();

interface CardKeyRow {
  id: string;
  plan: string;
  bound_devices: string;
  monthly_exp: number | null;
  is_banned: number;
  created_at: number;
}

function generateCardKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = 'NSK-';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)]!;
  return key;
}

// GET /api/cardkeys?page=1&limit=20
route.get('/', (c) => {
  const page = Math.max(Number(c.req.query('page') ?? '1'), 1);
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = (page - 1) * limit;

  const total = c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  const rows = c.env.DB.prepare(
    'SELECT id, plan, bound_devices, monthly_exp, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as CardKeyRow[];

  const cardkeys = rows.map((u) => {
    const devices: string[] = u.bound_devices ? JSON.parse(u.bound_devices) : [];
    return {
      id: u.id,
      plan: u.plan,
      device_count: devices.length,
      monthly_exp: u.monthly_exp ? new Date(u.monthly_exp * 1000).toISOString() : null,
      is_banned: u.is_banned === 1,
      created_at: new Date(u.created_at * 1000).toISOString(),
    };
  });

  return c.json({ cardkeys, total: total.n, page, limit });
});

// POST /api/cardkeys/generate
// Body: { plan: 'trial'|'monthly'|'lifetime', count?: number }
route.post('/generate', async (c) => {
  const body = await c.req.json<{ plan?: string; count?: number }>();
  const plan = body.plan ?? 'trial';
  const count = Math.min(body.count ?? 1, 50);

  if (!['trial', 'monthly', 'lifetime'].includes(plan)) {
    return c.json({ error: 'plan 必须是 trial/monthly/lifetime' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const generated: string[] = [];

  const insert = c.env.DB.prepare(
    'INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  for (let i = 0; i < count; i++) {
    const key = generateCardKey();
    const hash = sha256Hex(key);
    const id = randomId();

    let monthlyExp: number | null = null;
    if (plan === 'trial') monthlyExp = now + 7 * 86400;
    else if (plan === 'monthly') monthlyExp = now + 30 * 86400;

    insert.run(id, hash, plan, '[]', monthlyExp, now);
    generated.push(key);
  }

  return c.json({ generated, plan, count });
});

// POST /api/cardkeys/:id/renew
route.post('/:id/renew', (c) => {
  const id = c.req.param('id');
  const user = c.env.DB.prepare(
    'SELECT id, plan, monthly_exp FROM users WHERE id = ?',
  ).get(id) as CardKeyRow | undefined;
  if (!user) return c.json({ error: '卡密不存在' }, 404);
  if (user.plan === 'lifetime') return c.json({ error: '永久卡密无需续期' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const current = user.monthly_exp ?? now;
  const newExp = Math.max(current, now) + 30 * 86400;

  c.env.DB.prepare('UPDATE users SET monthly_exp = ?, is_banned = 0 WHERE id = ?').run(newExp, id);
  return c.json({ id, new_monthly_exp: new Date(newExp * 1000).toISOString() });
});

// POST /api/cardkeys/:id/revoke
route.post('/:id/revoke', (c) => {
  const id = c.req.param('id');
  c.env.DB.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(id);
  return c.json({ id, revoked: true });
});

export default route;
