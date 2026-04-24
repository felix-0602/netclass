import { Hono } from 'hono';
import type { Env } from '../index';
import { requireJwt } from '../lib/auth';
import type { JwtPayload } from '../lib/jwt';

const route = new Hono<{ Bindings: Env; Variables: { jwt: JwtPayload } }>();

route.use('*', requireJwt);

// POST /contribute
// 用户回传"我答对了"的题目，进 contributions 表等审核
route.post('/', async (c) => {
  const body = await c.req.json<{
    hash: string;
    text: string;
    options: Array<{ label: string; text: string | null; image_ref: string | null }>;
    composite_image_b64?: string;
    answer: { value: string; raw: string[] };
    user_confidence: 'high' | 'medium' | 'low';
    user_note?: string;
  }>();

  if (!body.hash || !body.answer) {
    return c.json({ error: { code: 'missing_fields', message: 'hash/answer 必填' } }, 400);
  }

  const jwt = c.get('jwt');

  // 若带图，存 R2（跟 /answer 一样，但 key 前缀 contributions/）
  // R2 未启用时丢弃图片，仅入库文本。
  let imageKey: string | null = null;
  if (body.composite_image_b64 && c.env.STORAGE) {
    imageKey = `contributions/${body.hash}-${Date.now()}.png`;
    const bytes = Uint8Array.from(atob(body.composite_image_b64), (ch) => ch.charCodeAt(0));
    await c.env.STORAGE.put(imageKey, bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO contributions
       (id, user_id, question_hash, text, options_json, image_key, submitted_answer, user_confidence, user_note, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
  )
    .bind(
      id,
      jwt.sub,
      body.hash,
      body.text,
      JSON.stringify(body.options),
      imageKey,
      JSON.stringify(body.answer),
      body.user_confidence,
      body.user_note ?? null,
      now,
    )
    .run();

  return c.json(
    {
      status: 'queued_for_review',
      contribution_id: id,
    },
    202,
  );
});

export default route;
