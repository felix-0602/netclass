import type { Context, Next } from 'hono';
import type { Env } from '../index';
import { verifyJwt, type JwtPayload } from './jwt';

/** 用户 JWT 鉴权中间件 */
export async function requireJwt(
  c: Context<{ Bindings: Env; Variables: { jwt: JwtPayload } }>,
  next: Next,
) {
  const authHeader = c.req.header('Authorization') ?? '';
  const m = authHeader.match(/^Bearer\s+(.+)$/);
  if (!m) {
    return c.json({ error: { code: 'jwt_missing', message: '需要 Authorization: Bearer <token>' } }, 401);
  }
  const payload = await verifyJwt(m[1], c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: { code: 'jwt_expired', message: 'JWT 失效或被篡改' } }, 401);
  }
  c.set('jwt', payload);
  await next();
}

/** 管理员 Key 鉴权中间件 */
export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  const key = c.req.header('X-Admin-Key');
  if (!key || key !== c.env.ADMIN_KEY) {
    return c.json({ error: { code: 'admin_required', message: 'X-Admin-Key 错或缺失' } }, 403);
  }
  await next();
}

/** sha256 + hex */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
