import { Hono } from 'hono';
import type { Env } from '../../index';
import { requireAdmin } from '../../lib/auth';

const route = new Hono<{ Bindings: Env }>();

route.use('*', requireAdmin);

route.post('/', async (c) => {
  const body = await c.req.json<{
    answers: Array<{
      id: string;
      answer: { value: string; raw: string[] };
      confidence: number;
      source?: string;
      note?: string;
    }>;
  }>();

  if (!body.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return c.json({ error: { code: 'empty_batch', message: 'answers 不能为空' } }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const accepted: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const a of body.answers) {
    try {
      const pending = await c.env.DB.prepare(
        'SELECT id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json FROM pending_q WHERE id = ?',
      )
        .bind(a.id)
        .first<{
          id: string;
          platform: string;
          q_type: string;
          text: string;
          options_json: string;
          tex_spans_json: string;
          image_key: string | null;
          context_json: string | null;
        }>();

      if (!pending) {
        const existing = await c.env.DB.prepare('SELECT id FROM questions WHERE id = ?').bind(a.id).first();
        if (existing) {
          rejected.push({ id: a.id, reason: 'already_answered' });
          continue;
        }
        rejected.push({ id: a.id, reason: 'not_in_pending' });
        continue;
      }

      const courseSig = pending.context_json
        ? (() => {
            const ctx = JSON.parse(pending.context_json);
            return `${ctx.course_id ?? ''}:${ctx.knowledge_id ?? ''}`;
          })()
        : null;

      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO questions
             (id, platform, q_type, text, options_json, tex_spans_json, image_key, course_sig,
              answer_json, confidence, source, verified_by, hit_count, first_seen, last_hit, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'founder', 0, ?, NULL, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          pending.id,
          pending.platform,
          pending.q_type,
          pending.text,
          pending.options_json,
          pending.tex_spans_json,
          pending.image_key,
          courseSig,
          JSON.stringify(a.answer),
          a.confidence,
          a.source ?? 'cc_drain',
          now,
          now,
        ),
        c.env.DB.prepare('DELETE FROM pending_q WHERE id = ? AND changes() > 0').bind(pending.id),
      ]);

      if ((results[0].meta.changes ?? 0) === 0) {
        rejected.push({ id: a.id, reason: 'already_answered' });
        continue;
      }

      accepted.push(a.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      rejected.push({ id: a.id, reason: message });
    }
  }

  return c.json({ accepted: accepted.length, rejected, accepted_ids: accepted });
});

export default route;
