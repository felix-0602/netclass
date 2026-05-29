import { Hono } from 'hono';
import type { AdminEnv } from '../env';

const route = new Hono<{ Bindings: AdminEnv }>();

interface UserRow {
  id: string;
  plan: string;
  bound_devices: string;
  monthly_exp: number | null;
  month_reset_at: number | null;
  is_banned: number;
  created_at: number;
}

// GET /api/users?page=1&limit=20
route.get('/', (c) => {
  const page = Math.max(Number(c.req.query('page') ?? '1'), 1);
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const offset = (page - 1) * limit;

  const total = c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  const rows = c.env.DB.prepare(
    'SELECT id, plan, bound_devices, monthly_exp, month_reset_at, is_banned, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as UserRow[];

  const users = rows.map((u) => {
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

  return c.json({ users, total: total.n, page, limit });
});

// POST /api/users/:id/toggle-ban
route.post('/:id/toggle-ban', (c) => {
  const id = c.req.param('id');
  const user = c.env.DB.prepare('SELECT is_banned FROM users WHERE id = ?').get(id) as
    | { is_banned: number }
    | undefined;
  if (!user) return c.json({ error: '用户不存在' }, 404);

  const newVal = user.is_banned === 1 ? 0 : 1;
  c.env.DB.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(newVal, id);
  return c.json({ id, is_banned: newVal === 1 });
});

// POST /api/users/:id/unbind-all
route.post('/:id/unbind-all', (c) => {
  const id = c.req.param('id');
  const user = c.env.DB.prepare('SELECT id FROM users WHERE id = ?').get(id) as
    | { id: string }
    | undefined;
  if (!user) return c.json({ error: '用户不存在' }, 404);

  c.env.DB.prepare("UPDATE users SET bound_devices = '[]' WHERE id = ?").run(id);
  c.env.DB.prepare('DELETE FROM user_devices WHERE user_id = ?').run(id);
  return c.json({ id, unbound: true });
});

export default route;
