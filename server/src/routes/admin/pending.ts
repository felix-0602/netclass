import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin } from '../../lib/auth';
import type { PendingRow } from '../../lib/types';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

// GET /admin/pending?limit=N&platform=X&type=Y
// cc-worker drain 拉待处理题
route.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10) || 10, 100);
  const platform = c.req.query('platform');
  const type = c.req.query('type');

  let sql =
    'SELECT id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, created_at FROM pending_q WHERE 1=1';
  const args: Array<string> = [];
  if (platform) {
    sql += ' AND platform = ?';
    args.push(platform);
  }
  if (type) {
    sql += ' AND q_type = ?';
    args.push(type);
  }
  sql += ' ORDER BY priority DESC, created_at ASC LIMIT ?';

  const rows = await c.env.DB.prepare(sql)
    .bind(...args, limit)
    .all<PendingRow>();

  const items = (rows.results ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    type: r.q_type,
    text: r.text,
    options: JSON.parse(r.options_json),
    tex_spans: JSON.parse(r.tex_spans_json),
    composite_image_url: r.image_key
      ? // R2 public URL. 部署时把 PLACEHOLDER 替换成 bucket 的 pub-<id>.r2.dev。
        `${c.env.STORAGE_PUBLIC_BASE ?? 'https://PLACEHOLDER.r2.dev'}/${r.image_key}`
      : null,
    context: r.context_json ? JSON.parse(r.context_json) : null,
    priority: r.priority,
    attempts: r.attempts,
    created_at: new Date(r.created_at * 1000).toISOString(),
  }));

  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM pending_q')
    .first<{ n: number }>();

  return c.json({ items, total_pending: total?.n ?? 0 });
});

// 扩 Env 用 — STORAGE_PUBLIC_BASE 可选 vars
declare module '../../index' {
  interface Env {
    STORAGE_PUBLIC_BASE?: string;
  }
}

export default route;
