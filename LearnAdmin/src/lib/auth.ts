import type { Context, Next } from 'hono';
import type { AdminEnv } from '../env';
import { createHash } from 'node:crypto';

export async function requireAdmin(c: Context<{ Bindings: AdminEnv }>, next: Next) {
  const key = c.req.header('X-Admin-Key');
  if (!key || key !== c.env.ADMIN_KEY) {
    return c.json({ error: 'X-Admin-Key 错或缺失' }, 403);
  }
  await next();
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomId(): string {
  return crypto.randomUUID();
}
