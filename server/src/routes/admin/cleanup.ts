// POST /admin/cleanup-broken
//
// 批量清掉 pending_q 里"显然答不了"的题。
// 防御 dry_run 默认 true，必须显式传 false 才真删。
//
// 判定标准（4 类，可按 criteria 数组单选）:
//   - missing_image_for_math: text 里含 <<M>> 占位但 image_key IS NULL
//   - empty_options:          所有选项 text 都是 null/空（提取链路坏了）
//   - short_text:             text 去掉占位后剩 < 10 字符
//   - very_old:               created_at < (now - days_old) 默认 30 天
//
// Body:
//   {
//     "dry_run": true,                                  // 必传，false 才删
//     "criteria": ["missing_image_for_math", ...],      // 可选，默认全选
//     "days_old": 30,                                   // very_old 阈值
//     "limit": 500                                      // 一次最多处理多少行
//   }
//
// Response:
//   {
//     "dry_run": true,
//     "matched": 20,
//     "deleted": 0,
//     "samples": [{ id, reason, text_preview }, ...]    // 前 10 条样本
//   }

import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin } from '../../lib/auth';
import type { PendingRow } from '../../lib/types';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

type Criterion =
  | 'missing_image_for_math'
  | 'empty_options'
  | 'short_text'
  | 'very_old';

const ALL_CRITERIA: Criterion[] = [
  'missing_image_for_math',
  'empty_options',
  'short_text',
  'very_old',
];

interface CleanupBody {
  dry_run?: boolean;
  criteria?: Criterion[];
  days_old?: number;
  limit?: number;
}

route.post('/', async (c) => {
  const body = await c.req.json<CleanupBody>().catch(() => ({}) as CleanupBody);
  const dryRun = body.dry_run !== false; // 默认 true，必须显式 false
  const criteria = body.criteria?.length ? body.criteria : ALL_CRITERIA;
  const daysOld = body.days_old ?? 30;
  const limit = Math.min(body.limit ?? 500, 5000);

  // 拉所有候选
  const rows = await c.env.DB.prepare(
    'SELECT id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, created_at FROM pending_q ORDER BY created_at ASC LIMIT ?',
  )
    .bind(limit)
    .all<PendingRow>();

  const cutoffSec = Math.floor(Date.now() / 1000) - daysOld * 86400;
  const matched: Array<{ id: string; reason: Criterion; text_preview: string }> = [];

  for (const r of rows.results ?? []) {
    const reason = matchReason(r, criteria, cutoffSec);
    if (reason) {
      matched.push({
        id: r.id,
        reason,
        text_preview: (r.text ?? '').slice(0, 60),
      });
    }
  }

  if (dryRun || matched.length === 0) {
    return c.json({
      dry_run: dryRun,
      matched: matched.length,
      deleted: 0,
      samples: matched.slice(0, 10),
      criteria,
    });
  }

  // 真删 — 按 id 批量
  const deleteSql = `DELETE FROM pending_q WHERE id IN (${matched.map(() => '?').join(',')})`;
  await c.env.DB.prepare(deleteSql)
    .bind(...matched.map((m) => m.id))
    .run();

  return c.json({
    dry_run: false,
    matched: matched.length,
    deleted: matched.length,
    samples: matched.slice(0, 10),
    criteria,
  });
});

function matchReason(
  row: PendingRow,
  criteria: readonly Criterion[],
  cutoffSec: number,
): Criterion | null {
  const text = row.text ?? '';
  const optionsRaw = row.options_json ?? '[]';

  if (criteria.includes('missing_image_for_math')) {
    if (text.includes('<<M') && !row.image_key) return 'missing_image_for_math';
  }
  if (criteria.includes('empty_options')) {
    let opts: Array<{ text: string | null }> = [];
    try {
      opts = JSON.parse(optionsRaw);
    } catch {
      opts = [];
    }
    if (
      opts.length > 0 &&
      opts.every((o) => o.text === null || (o.text ?? '').trim() === '')
    ) {
      return 'empty_options';
    }
  }
  if (criteria.includes('short_text')) {
    const stripped = text.replace(/<<M\d+>>/g, '').trim();
    if (stripped.length > 0 && stripped.length < 10) return 'short_text';
  }
  if (criteria.includes('very_old')) {
    if (row.created_at < cutoffSec) return 'very_old';
  }
  return null;
}

export default route;
