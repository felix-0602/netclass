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
// 鉴权：X-Admin-Key 或 JWT Bearer（双通道）

import { Hono } from 'hono';
import type { Env } from '../../index';
import { verifyJwt } from '../../lib/jwt';
import type { JwtPayload } from '../../lib/jwt';

const route = new Hono<{ Bindings: Env }>();

interface VerifyItem {
  hash: string;
  correct: boolean;
  source?: string;
}

route.post('/', async (c) => {
  // 双认证：Admin Key 或 JWT Bearer
  const adminKey = c.req.header('X-Admin-Key');
  let authOk = false;
  let jwtPayload: JwtPayload | null = null;

  if (adminKey && adminKey === c.env.ADMIN_KEY) {
    authOk = true;
  } else {
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      const m = authHeader.match(/^Bearer\s+(.+)$/);
      if (m) {
        jwtPayload = await verifyJwt(m[1], c.env.JWT_SECRET);
        if (jwtPayload) authOk = true;
      }
    }
  }
  if (!authOk) {
    return c.json({ error: { code: 'auth_required', message: '需要 X-Admin-Key 或登录态' } }, 401);
  }

  const body = await c.req.json<VerifyItem | { items: VerifyItem[] }>();
  const items: VerifyItem[] = 'items' in body ? body.items : [body];

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: { code: 'missing_fields', message: '需要 items 数组或单条 {hash, correct}' } }, 400);
  }

  let updated = 0;
  const notFound: string[] = [];

  for (const item of items) {
    if (!item.hash || typeof item.correct !== 'boolean') continue;
    const source = item.source ?? 'chaoxing_self_check';

    const row = await c.env.DB.prepare(
      'SELECT id, confidence, answer_json, platform, q_type, text, options_json, tex_spans_json, source AS ans_source FROM questions WHERE id = ?',
    ).bind(item.hash).first<{
      id: string; confidence: number;
      answer_json: string; platform: string; q_type: string;
      text: string; options_json: string; tex_spans_json: string; ans_source: string;
    }>();

    if (!row) { notFound.push(item.hash); continue; }

    const delta = item.correct ? 0.05 : -0.2;
    const newConf = Math.max(0, Math.min(1, (row.confidence ?? 0.5) + delta));
    const isVerifiedValue = item.correct ? 1 : 0;
    const now = Math.floor(Date.now() / 1000);

    // 错题 → 记录到 wrong_answers 审计表
    if (!item.correct) {
      const wrongId = crypto.randomUUID();
      try {
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO wrong_answers
             (id, question_hash, platform, q_type, text, options_json, tex_spans_json,
              answer_json, confidence, source, submitted_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(wrongId, item.hash, row.platform, row.q_type, row.text,
          row.options_json, row.tex_spans_json, row.answer_json,
          row.confidence, row.ans_source, jwtPayload?.sub ?? null, now).run();
      } catch { /* 非致命 */ }
    }

    await c.env.DB.prepare(
      'UPDATE questions SET is_verified = ?, verified_by = ?, confidence = ? WHERE id = ?',
    ).bind(isVerifiedValue, source, newConf, item.hash).run();
    updated++;
  }

  return c.json({ updated, not_found: notFound });
});

export default route;
