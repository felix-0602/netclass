import { Hono } from 'hono';
import type { Env } from '../index';
import { requireJwt } from '../lib/auth';
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
    'SELECT id, answer_json, confidence, source, last_hit FROM questions WHERE id = ?',
  )
    .bind(serverHash)
    .first<Pick<QuestionRow, 'id' | 'answer_json' | 'confidence' | 'source' | 'last_hit'>>();

  if (hit) {
    const now = Math.floor(Date.now() / 1000);
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE questions SET hit_count = hit_count + 1, last_hit = ? WHERE id = ?',
      )
        .bind(now, serverHash)
        .run(),
    );
    return c.json({
      status: 'hit',
      answer: JSON.parse(hit.answer_json),
      source: hit.source,
      updated_at: new Date((hit.last_hit ?? now) * 1000).toISOString(),
    });
  }

  let imageKey: string | null = null;
  if (body.composite_image_b64) {
    imageKey = `stitched/${serverHash}.png`;
    const bytes = Uint8Array.from(atob(body.composite_image_b64), (ch) => ch.charCodeAt(0));
    await c.env.STORAGE.put(imageKey, bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
  }

  const contextJson = body.context ? JSON.stringify(body.context) : null;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO pending_q
       (id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, submitted_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      serverHash,
      body.platform,
      body.type,
      body.text,
      JSON.stringify(body.options),
      JSON.stringify(body.tex_spans),
      imageKey,
      contextJson,
      5,
      jwt.sub,
      now,
    )
    .run();

  return c.json(
    {
      status: 'pending',
      queued_at: new Date(now * 1000).toISOString(),
      hint: '题库暂无此题，已提交审核队列，稍后再来即命中',
    },
    202,
  );
});

export default route;
