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
    // 修：原标准 `text 含 <<M>> && 无 image` 过度激进 — chaoxing 大多数公式题 img.data
    // 里有 URL-encoded LaTeX，extractor 写到 tex_spans[i].latex，drain 直接读 latex 就能答。
    // 真正"没法读"的是：占位在题干 + 没图 + tex_spans 里所有 latex 都是 null。
    if (text.includes('<<M') && !row.image_key) {
      let texSpans: Array<{ latex: string | null; image_idx: number | null }> = [];
      try {
        texSpans = JSON.parse(row.tex_spans_json ?? '[]');
      } catch {
        texSpans = [];
      }
      const allLatexNull =
        texSpans.length === 0 ||
        texSpans.every((t) => t.latex === null || (t.latex ?? '').trim() === '');
      if (allLatexNull) return 'missing_image_for_math';
    }
  }
  if (criteria.includes('empty_options')) {
    // 修：旧版只看 o.text 漏掉 image_ref + tex_spans.latex 路径。
    // 选项可能是 "text=null + image_ref=<<M2>> + tex_spans[M2].latex='y=2x+C'" — drain 直接读 latex 答。
    // 实测 prod dry-run 命中 3 道全是这种带 LaTeX 图的好题，旧标准会误删。
    // 新判定：text 空 AND (image_ref 空 OR 对应 latex 也空 AND 没 image_key) → 真不可读
    let opts: Array<{ text: string | null; image_ref: string | null }> = [];
    let texSpans: Array<{ placeholder: string; latex: string | null }> = [];
    try {
      opts = JSON.parse(optionsRaw);
      texSpans = JSON.parse(row.tex_spans_json ?? '[]');
    } catch {
      opts = [];
    }
    const latexByPh: Record<string, string | null> = {};
    for (const t of texSpans) latexByPh[t.placeholder] = t.latex ?? null;

    const isOptionEmpty = (o: { text: string | null; image_ref: string | null }): boolean => {
      const hasText = o.text !== null && (o.text ?? '').trim() !== '';
      if (hasText) return false;
      if (!o.image_ref) return true; // 文本空 + 没图 ref = 真空
      const lx = latexByPh[o.image_ref];
      const hasLatex = lx !== null && (lx ?? '').trim() !== '';
      if (hasLatex) return false; // 有 latex 文本 → drain 可读
      // 文本空 + image_ref 但 latex 空 → 看题级 image_key 是否有图（compose 拍下来了）
      // image_key 非空 = vision 还能救；为空 = 真无救
      return !row.image_key;
    };

    if (opts.length > 0 && opts.every(isOptionEmpty)) {
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
