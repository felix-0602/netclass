// 端到端 round-trip：客户端查 → 服务端 pending → drain 提交 → 再查命中
// 覆盖 Phase 0 Week 2 的硬目标：证明三层架构（client/server/drain）能闭环
// 协议契约见 docs/PROTOCOL.md
//
// Node + better-sqlite3 版本（迁出 Workers Pool 后）

import { beforeEach, describe, expect, test } from 'vitest';
import { signJwt } from '../src/lib/jwt';
import { sha256Hex } from '../src/lib/auth';
import { hashQuestion } from '../src/lib/hash';
import { createTestCtx, type TestCtx } from './_helpers';

const DEVICE_FP = 'test-device-fp-0001';

/** 构造一个测试题目（非公式题，避免触发合成图写入） */
const TEST_QUESTION = {
  platform: 'chaoxing' as const,
  type: 'single' as const,
  text: '已知函数 f(x)=2x+1，求 f(3) 的值。',
  options: [
    { label: 'A', text: '5', image_ref: null },
    { label: 'B', text: '7', image_ref: null },
    { label: 'C', text: '9', image_ref: null },
    { label: 'D', text: '11', image_ref: null },
  ],
  tex_spans: [],
  context: {
    course_id: '100001',
    clazz_id: '200001',
    knowledge_id: '300001',
    work_id: '400001',
  },
};

async function seedTestUser(ctx: TestCtx, userId: string): Promise<void> {
  const cardkeyHash = await sha256Hex(`cardkey-${userId}`);
  const now = Math.floor(Date.now() / 1000);
  await ctx.env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, cardkey_hash, plan, monthly_exp, created_at)
     VALUES (?, ?, 'lifetime', NULL, ?)`,
  )
    .bind(userId, cardkeyHash, now)
    .run();
}

async function mintJwt(ctx: TestCtx, userId: string): Promise<string> {
  const fp = await sha256Hex(DEVICE_FP);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return signJwt({ sub: userId, plan: 'lifetime', exp, fp }, ctx.env.JWT_SECRET);
}

describe('端到端 round-trip', () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = createTestCtx();
  });

  test('完整链路：/answer pending → /admin/submit → /answer hit', async () => {
    await seedTestUser(ctx, 'user-roundtrip-1');
    const jwt = await mintJwt(ctx, 'user-roundtrip-1');
    const serverHash = await hashQuestion(TEST_QUESTION);

    // 阶段 1：第一次 /answer，期望 202 pending
    const first = await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({ ...TEST_QUESTION, hash: serverHash }),
    });
    expect(first.status).toBe(202);
    const firstJson = (await first.json()) as { status: string };
    expect(firstJson.status).toBe('pending');

    // 阶段 2：drain 侧 GET /admin/pending → 应看到 1 条
    const pendingResp = await ctx.fetch('/admin/pending?limit=10', {
      headers: { 'X-Admin-Key': ctx.env.ADMIN_KEY },
    });
    expect(pendingResp.status).toBe(200);
    const pendingJson = (await pendingResp.json()) as {
      items: Array<{ id: string; platform: string; type: string }>;
      total_pending: number;
    };
    expect(pendingJson.total_pending).toBe(1);
    expect(pendingJson.items[0]!.id).toBe(serverHash);
    expect(pendingJson.items[0]!.platform).toBe('chaoxing');

    // 阶段 3：drain 侧 POST /admin/submit 回写答案
    const submitResp = await ctx.fetch('/admin/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ctx.env.ADMIN_KEY,
      },
      body: JSON.stringify({
        answers: [
          {
            id: serverHash,
            answer: { value: 'B', raw: ['B'] },
            confidence: 0.98,
            source: 'cc_drain',
            note: '代入 f(3) = 2*3+1 = 7',
          },
        ],
      }),
    });
    expect(submitResp.status).toBe(200);
    const submitJson = (await submitResp.json()) as {
      accepted: number;
      rejected: unknown[];
      accepted_ids: string[];
    };
    expect(submitJson.accepted).toBe(1);
    expect(submitJson.accepted_ids).toContain(serverHash);
    expect(submitJson.rejected).toHaveLength(0);

    // 阶段 4：客户端再查同题 → 应 200 hit
    const second = await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({ ...TEST_QUESTION, hash: serverHash }),
    });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as {
      status: string;
      answer: { value: string; raw: string[] };
      source: string;
    };
    expect(secondJson.status).toBe('hit');
    expect(secondJson.answer.value).toBe('B');
    expect(secondJson.source).toBe('cc_drain');

    // 阶段 5：数据库一致性
    const qCount = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM questions')
      .first<{ n: number }>();
    const pqCount = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM pending_q')
      .first<{ n: number }>();
    expect(qCount?.n).toBe(1);
    expect(pqCount?.n).toBe(0);
  });

  test('/answer 拒绝客户端 hash 不匹配', async () => {
    await seedTestUser(ctx, 'user-roundtrip-2');
    const jwt = await mintJwt(ctx, 'user-roundtrip-2');

    const resp = await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({ ...TEST_QUESTION, hash: '0'.repeat(64) }),
    });
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { error: { code: string } };
    expect(json.error.code).toBe('hash_mismatch');
  });

  test('/admin/submit 已答题返回 rejected', async () => {
    await seedTestUser(ctx, 'user-roundtrip-3');
    const jwt = await mintJwt(ctx, 'user-roundtrip-3');
    const serverHash = await hashQuestion(TEST_QUESTION);

    await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({ ...TEST_QUESTION, hash: serverHash }),
    });

    const submitBody = {
      answers: [{ id: serverHash, answer: { value: 'B', raw: ['B'] }, confidence: 0.9 }],
    };

    const r1 = await ctx.fetch('/admin/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ctx.env.ADMIN_KEY },
      body: JSON.stringify(submitBody),
    });
    const r1Json = (await r1.json()) as { accepted: number };
    expect(r1Json.accepted).toBe(1);

    const stored = await ctx.env.DB.prepare('SELECT * FROM questions WHERE id = ?')
      .bind(serverHash)
      .first();
    expect(stored).toBeTruthy();

    const r2 = await ctx.fetch('/admin/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ctx.env.ADMIN_KEY },
      body: JSON.stringify(submitBody),
    });
    const r2Json = (await r2.json()) as {
      accepted: number;
      rejected: Array<{ id: string; reason: string }>;
    };
    expect(r2Json.accepted).toBe(0);
    expect(r2Json.rejected).toHaveLength(1);
    expect(['already_answered', 'not_in_pending']).toContain(r2Json.rejected[0]!.reason);
  });

  test('/admin/pending 需要 X-Admin-Key 才能访问', async () => {
    const resp = await ctx.fetch('/admin/pending');
    expect(resp.status).toBe(403);
    const json = (await resp.json()) as { error: { code: string } };
    expect(json.error.code).toBe('admin_required');
  });

  test('/answer 缺 JWT 返回 401', async () => {
    const serverHash = await hashQuestion(TEST_QUESTION);
    const resp = await ctx.fetch('/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...TEST_QUESTION, hash: serverHash }),
    });
    expect(resp.status).toBe(401);
  });
});
