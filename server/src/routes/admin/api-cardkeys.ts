import { Hono } from 'hono';
import type { Env } from '../../index';
import { sha256Hex } from '../../lib/auth';

const route = new Hono<{ Bindings: Env }>();

interface CardKeyRow {
  id: string;
  plan: string;
  monthly_exp: number | null;
  is_banned: number;
  created_at: number;
}

function randomId(): string {
  return crypto.randomUUID();
}

function generateCardKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = 'NSK-';
  for (let i = 0; i < 8; i++) key += chars[Math.floor(Math.random() * chars.length)]!;
  return key;
}

route.get('/', async (c) => {
  const page = Math.max(Number(c.req.query('page') ?? '1'), 1);
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const r = await c.env.DB.prepare(
    'SELECT id, plan, monthly_exp, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(limit, offset).all<CardKeyRow>();

  const cardkeys = (r.results ?? []).map((u) => ({
    id: u.id,
    plan: u.plan,
    monthly_exp: u.monthly_exp ? new Date(u.monthly_exp * 1000).toISOString() : null,
    is_banned: u.is_banned === 1,
    created_at: new Date(u.created_at * 1000).toISOString(),
  }));

  return c.json({ cardkeys, total: total?.n ?? 0, page, limit });
});

route.post('/generate', async (c) => {
  const body = await c.req.json<{ plan?: string; count?: number }>();
  const plan = body.plan ?? 'trial';
  const count = Math.min(body.count ?? 1, 50);

  if (!['trial', 'monthly', 'lifetime'].includes(plan)) {
    return c.json({ error: 'plan 必须是 trial/monthly/lifetime' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const generated: string[] = [];

  for (let i = 0; i < count; i++) {
    const key = generateCardKey();
    const hash = sha256Hex(key);
    const id = randomId();

    let monthlyExp: number | null = null;
    if (plan === 'trial') monthlyExp = now + 7 * 86400;
    else if (plan === 'monthly') monthlyExp = now + 30 * 86400;

    await c.env.DB.prepare(
      'INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, hash, plan, '[]', monthlyExp, now).run();
    generated.push(key);
  }

  return c.json({ generated, plan, count });
});

route.post('/:id/renew', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT id, plan, monthly_exp FROM users WHERE id = ?').bind(id).first<CardKeyRow>();
  if (!user) return c.json({ error: '卡密不存在' }, 404);
  if (user.plan === 'lifetime') return c.json({ error: '永久卡密无需续期' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const current = user.monthly_exp ?? now;
  const newExp = Math.max(current, now) + 30 * 86400;

  await c.env.DB.prepare('UPDATE users SET monthly_exp = ?, is_banned = 0 WHERE id = ?').bind(newExp, id).run();
  return c.json({ id, new_monthly_exp: new Date(newExp * 1000).toISOString() });
});

route.post('/:id/revoke', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').bind(id).run();
  return c.json({ id, revoked: true });
});

export default route;
