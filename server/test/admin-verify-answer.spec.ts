import { beforeEach, describe, expect, test } from 'vitest';
import { createTestCtx, type TestCtx } from './_helpers';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

let ctx: TestCtx;

beforeEach(() => {
  ctx = createTestCtx();
  // seed 2 道已答题
  const now = Math.floor(Date.now() / 1000);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO questions (id, platform, q_type, text, options_json, tex_spans_json, image_key, course_sig, answer_json, confidence, source, hit_count, first_seen, last_hit, created_at)
       VALUES (?, 'chaoxing', 'single', 'q1?', '[]', '[]', NULL, NULL, ?, ?, 'cc_drain', 1, ?, ?, ?)`,
    )
    .run('hash-q1', JSON.stringify({ value: 'A', raw: ['A'] }), 0.5, now, now, now);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO questions (id, platform, q_type, text, options_json, tex_spans_json, image_key, course_sig, answer_json, confidence, source, hit_count, first_seen, last_hit, created_at)
       VALUES (?, 'chaoxing', 'single', 'q2?', '[]', '[]', NULL, NULL, ?, ?, 'cc_drain', 1, ?, ?, ?)`,
    )
    .run('hash-q2', JSON.stringify({ value: 'B', raw: ['B'] }), 0.9, now, now, now);
});

async function callVerify(body: object): Promise<Response> {
  return ctx.fetch('/admin/verify-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
    body: JSON.stringify(body),
  });
}

describe('POST /admin/verify-answer', () => {
  test('单条 correct → confidence +0.05', async () => {
    const res = await callVerify({ hash: 'hash-q1', correct: true });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { updated: number };
    expect(j.updated).toBe(1);

    const r = ctx.env.rawDb
      .prepare('SELECT confidence, verified_by FROM questions WHERE id = ?')
      .get('hash-q1') as { confidence: number; verified_by: string };
    expect(r.confidence).toBeCloseTo(0.55);
    expect(r.verified_by).toBe('chaoxing_self_check');
  });

  test('单条 wrong → confidence -0.2', async () => {
    const res = await callVerify({ hash: 'hash-q2', correct: false });
    const j = (await res.json()) as { updated: number };
    expect(j.updated).toBe(1);

    const r = ctx.env.rawDb
      .prepare('SELECT confidence FROM questions WHERE id = ?')
      .get('hash-q2') as { confidence: number };
    expect(r.confidence).toBeCloseTo(0.7);
  });

  test('confidence cap 0..1', async () => {
    // q1 confidence 0.5 → +0.05 多次累加封顶 1.0
    for (let i = 0; i < 20; i++) {
      await callVerify({ hash: 'hash-q1', correct: true });
    }
    const r = ctx.env.rawDb
      .prepare('SELECT confidence FROM questions WHERE id = ?')
      .get('hash-q1') as { confidence: number };
    expect(r.confidence).toBe(1);
  });

  test('批量 items 数组', async () => {
    const res = await callVerify({
      items: [
        { hash: 'hash-q1', correct: true },
        { hash: 'hash-q2', correct: false },
        { hash: 'hash-not-exists', correct: true },
      ],
    });
    const j = (await res.json()) as { updated: number; not_found: string[] };
    expect(j.updated).toBe(2);
    expect(j.not_found).toEqual(['hash-not-exists']);
  });

  test('鉴权失败 → 401/403', async () => {
    const res = await ctx.fetch('/admin/verify-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'hash-q1', correct: true }),
    });
    expect([401, 403]).toContain(res.status);
  });
});
