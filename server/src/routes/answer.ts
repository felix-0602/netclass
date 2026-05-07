import { Hono } from 'hono';
import type { Env } from '../index';
import { requireJwt } from '../lib/auth';
import { callDeepSeek } from '../lib/deepseek';
import { hashQuestion } from '../lib/hash';
import type { JwtPayload } from '../lib/jwt';
import type { QuestionRow } from '../lib/types';

const route = new Hono<{ Bindings: Env; Variables: { jwt: JwtPayload } }>();

route.use('*', requireJwt);

route.post('/', async (c) => {
  const body = await c.req.json<{
    platform: 'chaoxing' | 'zhihuishu' | 'unipus';
    question_id?: string;
    hash: string;
    type: 'single' | 'multi' | 'judge' | 'fill' | 'essay';
    text: string;
    options: Array<{ label: string; text: string | null; image_ref: string | null }>;
    tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
    composite_image_b64?: string;
    context?: {
      course_id?: string;
      clazz_id?: string;
      knowledge_id?: string;
      work_id?: string;
    };
  }>();

  if (!body.hash || !body.type || !body.platform) {
    return c.json({ error: { code: 'missing_fields', message: 'hash/type/platform 必填' } }, 400);
  }

  const serverHash = await hashQuestion({
    platform: body.platform,
    type: body.type,
    text: body.text,
    options: body.options,
    tex_spans: body.tex_spans,
  });

  if (body.hash !== serverHash) {
    return c.json({ error: { code: 'hash_mismatch' } }, 400);
  }

  const jwt = c.get('jwt');

  const hit = await c.env.DB.prepare(
    'SELECT id, answer_json, confidence, source, last_hit, is_verified FROM questions WHERE id = ?',
  )
    .bind(serverHash)
    .first<Pick<QuestionRow, 'id' | 'answer_json' | 'confidence' | 'source' | 'last_hit'> & { is_verified: number | null }>();

  const texSpansArr = body.tex_spans ?? [];
  const hasBlindSpots = texSpansArr.some(
    (t) => t.latex === null && t.image_idx !== null,
  );

  if (hit) {
    // 已知错题（is_verified === 0）且非看图题 → 调 DeepSeek 重答
    if (hit.is_verified === 0 && !hasBlindSpots) {
      const dsResult = await callDeepSeek(
        { type: body.type, text: body.text, options: body.options, tex_spans: body.tex_spans },
        c.env.DEEPSEEK_API_KEY,
      );
      if (dsResult) {
        const now = Math.floor(Date.now() / 1000);
        // 记录旧错题到 wrong_answers
        const wrongId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO wrong_answers
             (id, question_hash, platform, q_type, text, options_json, tex_spans_json,
              answer_json, confidence, source, submitted_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(wrongId, serverHash, body.platform, body.type, body.text,
          JSON.stringify(body.options), JSON.stringify(body.tex_spans),
          hit.answer_json, hit.confidence, hit.source, jwt.sub, now).run();
        // 更新答案为 DeepSeek 新答案
        await c.env.DB.prepare(
          'UPDATE questions SET answer_json = ?, confidence = ?, source = ?, is_verified = NULL WHERE id = ?',
        ).bind(JSON.stringify(dsResult), 0.85, 'deepseek-api', serverHash).run();

        return c.json({
          status: 'hit',
          answer: dsResult,
          source: 'deepseek-api',
          updated_at: new Date(now * 1000).toISOString(),
        });
      }
      // DeepSeek 失败 → 返回原错题答案（比什么都没有好）
    }

    const now = Math.floor(Date.now() / 1000);
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE questions SET hit_count = hit_count + 1, last_hit = ? WHERE id = ?',
      ).bind(now, serverHash).run(),
    );
    return c.json({
      status: 'hit',
      answer: JSON.parse(hit.answer_json),
      source: hit.source,
      updated_at: new Date((hit.last_hit ?? now) * 1000).toISOString(),
    });
  }

  // ===== 缓存未命中 =====

  // 纯文本题 → 调 DeepSeek 实时作答
  if (!hasBlindSpots && body.type !== 'essay') {
    const dsResult = await callDeepSeek(
      { type: body.type, text: body.text, options: body.options, tex_spans: body.tex_spans },
      c.env.DEEPSEEK_API_KEY,
    );
    if (dsResult) {
      // 存合成图（如有）
      let imageKey: string | null = null;
      if (body.composite_image_b64 && c.env.STORAGE) {
        imageKey = `stitched/${serverHash}.png`;
        const bytes = Uint8Array.from(atob(body.composite_image_b64), (ch) => ch.charCodeAt(0));
        await c.env.STORAGE.put(imageKey, bytes, { httpMetadata: { contentType: 'image/png' } });
      }
      const courseSig = body.context
        ? `${body.context.course_id ?? ''}:${body.context.knowledge_id ?? ''}`
        : null;
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO questions
           (id, platform, q_type, text, options_json, tex_spans_json, image_key, course_sig,
            answer_json, confidence, source, verified_by, hit_count, first_seen, created_at, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.85, 'deepseek-api', NULL, 0, ?, ?, NULL)`,
      ).bind(serverHash, body.platform, body.type, body.text,
        JSON.stringify(body.options), JSON.stringify(body.tex_spans),
        imageKey, courseSig, JSON.stringify(dsResult), now, now).run();

      return c.json({
        status: 'hit',
        answer: dsResult,
        source: 'deepseek-api',
        updated_at: new Date(now * 1000).toISOString(),
      });
    }
    // DeepSeek 失败 → 回退 pending_q
  }

  // ===== 回退到 pending_q（看图题 / 论述题 / DeepSeek 失败）=====

  let imageKey: string | null = null;
  if (body.composite_image_b64) {
    if (c.env.STORAGE) {
      imageKey = `stitched/${serverHash}.png`;
      const bytes = Uint8Array.from(atob(body.composite_image_b64), (ch) => ch.charCodeAt(0));
      await c.env.STORAGE.put(imageKey, bytes, { httpMetadata: { contentType: 'image/png' } });
    }
  }

  const contextJson = body.context ? JSON.stringify(body.context) : null;
  const needsVision = imageKey !== null && hasBlindSpots ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO pending_q
       (id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, needs_vision, submitted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).bind(serverHash, body.platform, body.type, body.text,
    JSON.stringify(body.options), JSON.stringify(body.tex_spans),
    imageKey, contextJson, 5, needsVision, jwt.sub, now).run();

  return c.json({
    status: 'pending',
    queued_at: new Date(now * 1000).toISOString(),
    hint: '题库暂无此题，已提交审核队列，稍后再来即命中',
  }, 202);
});

export default route;
