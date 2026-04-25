// POST /admin/verify-answer
//
// 客户端做完一套题 + chaoxing 自动批改后，把每道题的对错回传给服务端。
// 用于：
//   - 校准 questions 表 confidence (对 → +0.05, 错 → -0.2 capped)
//   - 设 verified_by = 'chaoxing_self_check' 表明已经经过 chaoxing 批改验证
//   - 可作 reuse-rate 探针真口径（hit_count + 正确率）的输入
//
// Body (单条 or 批量):
//   { hash: "<sha256>", correct: true, source?: "chaoxing_self_check" }
// 或
//   { items: [{hash, correct}, ...] }
//
// Response: { updated: N, not_found: [hash...] }
//
// 鉴权：X-Admin-Key

import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin } from '../../lib/auth';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

interface VerifyItem {
  hash: string;
  correct: boolean;
  source?: string;
}

route.post('/', async (c) => {
  const body = await c.req.json<VerifyItem | { items: VerifyItem[] }>();
  const items: VerifyItem[] = 'items' in body ? body.items : [body];

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: { code: 'missing_fields', message: '需要 items 数组或单条 {hash, correct}' } }, 400);
  }

  let updated = 0;
  const notFound: string[] = [];

  for (const item of items) {
    if (!item.hash || typeof item.correct !== 'boolean') {
      continue;
    }
    const source = item.source ?? 'chaoxing_self_check';
    const row = await c.env.DB.prepare(
      'SELECT id, confidence FROM questions WHERE id = ?',
    )
      .bind(item.hash)
      .first<{ id: string; confidence: number }>();

    if (!row) {
      notFound.push(item.hash);
      continue;
    }

    // 调整 confidence：对 → +0.05 cap 1.0；错 → -0.2 floor 0.0
    const delta = item.correct ? 0.05 : -0.2;
    const newConf = Math.max(0, Math.min(1, (row.confidence ?? 0.5) + delta));

    await c.env.DB.prepare(
      'UPDATE questions SET verified_by = ?, confidence = ? WHERE id = ?',
    )
      .bind(source, newConf, item.hash)
      .run();
    updated++;
  }

  return c.json({ updated, not_found: notFound });
});

export default route;
