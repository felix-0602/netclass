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
    // attempts 不再过滤：drain worker 改为实时消化（runner 原地等待答案），
    // 老的 attempts<3 过滤会让热重试中的题对 worker 隐身，测验闭环断裂。
    'SELECT id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, needs_vision, created_at FROM pending_q WHERE 1=1';
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

  // 拼图 URL：
  //   - 配了 STORAGE_PUBLIC_BASE → 用公共 R2 URL（最快，cdn 可缓存）
  //   - 没配 → 走 /admin/image/{hash} endpoint（需 admin key）— 实测 Phase 0 默认这条
  // 旧版本回 PLACEHOLDER URL 是垃圾误导，第三方读 admin/pending 直接 404
  const baseHost = `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
  const imageUrlOf = (key: string | null): string | null => {
    if (!key) return null;
    if (c.env.STORAGE_PUBLIC_BASE) return `${c.env.STORAGE_PUBLIC_BASE}/${key}`;
    // image_key 形如 stitched/<hash>.png；admin/image endpoint 取 hash 部分
    const hash = key.replace(/^stitched\//, '').replace(/\.png$/, '');
    return `${baseHost}/admin/image/${hash}`;
  };

  const items = (rows.results ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    type: r.q_type,
    text: r.text,
    options: JSON.parse(r.options_json),
    tex_spans: JSON.parse(r.tex_spans_json),
    composite_image_url: imageUrlOf(r.image_key),
    context: r.context_json ? JSON.parse(r.context_json) : null,
    priority: r.priority,
    attempts: r.attempts,
    needs_vision: r.needs_vision === 1,
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
