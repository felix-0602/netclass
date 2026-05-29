import { Hono } from 'hono';
import type { Env } from '../../index';

const route = new Hono<{ Bindings: Env }>();

interface UserRow {
  id: string;
  plan: string;
  bound_devices: string;
  monthly_exp: number | null;
  month_reset_at: number | null;
  is_banned: number;
  created_at: number;
}

route.get('/', async (c) => {
  const page = Math.max(Number(c.req.query('page') ?? '1'), 1);
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const r = await c.env.DB.prepare(
    'SELECT id, plan, bound_devices, monthly_exp, month_reset_at, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(limit, offset).all<UserRow>();

  const users = (r.results ?? []).map((u) => {
    const devices: string[] = u.bound_devices ? JSON.parse(u.bound_devices) : [];
    return {
      id: u.id,
      plan: u.plan,
      device_count: devices.length,
      devices,
      monthly_exp: u.monthly_exp ? new Date(u.monthly_exp * 1000).toISOString() : null,
      is_banned: u.is_banned === 1,
      created_at: new Date(u.created_at * 1000).toISOString(),
    };
  });

  return c.json({ users, total: total?.n ?? 0, page, limit });
});

route.post('/:id/toggle-ban', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT is_banned FROM users WHERE id = ?').bind(id).first<{ is_banned: number }>();
  if (!user) return c.json({ error: '用户不存在' }, 404);

  const newVal = user.is_banned === 1 ? 0 : 1;
  await c.env.DB.prepare('UPDATE users SET is_banned = ? WHERE id = ?').bind(newVal, id).run();
  return c.json({ id, is_banned: newVal === 1 });
});

route.post('/:id/unbind-all', async (c) => {
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first<{ id: string }>();
  if (!user) return c.json({ error: '用户不存在' }, 404);

  await c.env.DB.prepare("UPDATE users SET bound_devices = '[]' WHERE id = ?").bind(id).run();
  try { await c.env.DB.prepare('DELETE FROM user_devices WHERE user_id = ?').bind(id).run(); } catch { /* 表可能不存在 */ }
  return c.json({ id, unbound: true });
});

export default route;
