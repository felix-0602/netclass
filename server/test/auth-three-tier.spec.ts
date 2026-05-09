// 三档卡密（trial / monthly / lifetime）认证逻辑覆盖测试
// 核心变化：trial/monthly 从"首次激活"起算过期，而非从生成时起算

import { beforeEach, describe, expect, test } from 'vitest';
import { sha256Hex } from '../src/lib/auth';
import { createTestCtx, type TestCtx } from './_helpers';

const TRIAL_KEY = 'NSK-TRIAL-TEST-000000000000001';
const MONTHLY_KEY = 'NSK-MONTHLY-TEST-0000000000002';
const LIFETIME_KEY = 'NSK-LIFETIME-TEST-000000000003';
const EXPIRED_TRIAL_KEY = 'NSK-EXPIRED-TRIAL-00000000004';
const EXPIRED_MONTHLY_KEY = 'NSK-EXPIRED-MONTHLY-0000005';

let ctx: TestCtx;
let now: number;

beforeEach(async () => {
  ctx = createTestCtx();
  now = Math.floor(Date.now() / 1000);

  // trial 卡密 — 未激活（monthly_exp = NULL）
  const trialHash = await sha256Hex(TRIAL_KEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at)
       VALUES (?, ?, 'trial', '[]', NULL, ?)`,
    )
    .run('user-trial', trialHash, now);

  // monthly 卡密 — 未激活
  const monthlyHash = await sha256Hex(MONTHLY_KEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at)
       VALUES (?, ?, 'monthly', '[]', NULL, ?)`,
    )
    .run('user-monthly', monthlyHash, now);

  // lifetime 卡密 — 无过期
  const lifetimeHash = await sha256Hex(LIFETIME_KEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at)
       VALUES (?, ?, 'lifetime', '[]', NULL, ?)`,
    )
    .run('user-lifetime', lifetimeHash, now);

  // 已过期的 trial（monthly_exp = 7 天前）
  const expiredTrialHash = await sha256Hex(EXPIRED_TRIAL_KEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at)
       VALUES (?, ?, 'trial', '[]', ?, ?)`,
    )
    .run('user-expired-trial', expiredTrialHash, now - 8 * 24 * 3600, now - 8 * 24 * 3600);

  // 已过期的 monthly（monthly_exp = 31 天前）
  const expiredMonthlyHash = await sha256Hex(EXPIRED_MONTHLY_KEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at)
       VALUES (?, ?, 'monthly', '[]', ?, ?)`,
    )
    .run('user-expired-monthly', expiredMonthlyHash, now - 32 * 24 * 3600, now - 32 * 24 * 3600);
});

async function callAuth(cardkey: string, fp: string): Promise<Response> {
  return ctx.fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardkey, device_fingerprint: fp }),
  });
}

describe('trial plan', () => {
  test('首次激活：monthly_exp 为 NULL 时自动写入 7 天过期', async () => {
    const res = await callAuth(TRIAL_KEY, 'fp-trial-1');
    expect(res.status).toBe(200);

    const json = (await res.json()) as { plan: string; month_exp: string };
    expect(json.plan).toBe('trial');
    expect(json.month_exp).toBeTruthy();

    // 验证数据库写入
    const u = ctx.env.rawDb
      .prepare('SELECT monthly_exp FROM users WHERE id = ?')
      .get('user-trial') as { monthly_exp: number };
    expect(u.monthly_exp).toBeGreaterThan(now);
    // 7 天 ± 5 秒容错
    const expectedExp = now + 7 * 24 * 3600;
    expect(Math.abs(u.monthly_exp - expectedExp)).toBeLessThan(5);

    // 第二次激活不应改变 expiry
    const res2 = await callAuth(TRIAL_KEY, 'fp-trial-2');
    expect(res2.status).toBe(200);
    const u2 = ctx.env.rawDb
      .prepare('SELECT monthly_exp FROM users WHERE id = ?')
      .get('user-trial') as { monthly_exp: number };
    expect(u2.monthly_exp).toBe(u.monthly_exp); // 不变
  });

  test('过期 trial 卡密 → cardkey_expired', async () => {
    const res = await callAuth(EXPIRED_TRIAL_KEY, 'fp-exp-trial');
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('cardkey_expired');
    expect(json.error.message).toContain('试用');
  });

  test('trial 设备上限 = 3', async () => {
    // 先激活 3 个设备
    await callAuth(TRIAL_KEY, 'fp-a');
    await callAuth(TRIAL_KEY, 'fp-b');
    await callAuth(TRIAL_KEY, 'fp-c');

    const res = await callAuth(TRIAL_KEY, 'fp-d');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('device_limit');
  });
});

describe('monthly plan', () => {
  test('首次激活：monthly_exp 为 NULL 时自动写入 30 天过期', async () => {
    const res = await callAuth(MONTHLY_KEY, 'fp-month-1');
    expect(res.status).toBe(200);

    const json = (await res.json()) as { plan: string; month_exp: string };
    expect(json.plan).toBe('monthly');
    expect(json.month_exp).toBeTruthy();

    const u = ctx.env.rawDb
      .prepare('SELECT monthly_exp FROM users WHERE id = ?')
      .get('user-monthly') as { monthly_exp: number };
    expect(u.monthly_exp).toBeGreaterThan(now);
    const expectedExp = now + 30 * 24 * 3600;
    expect(Math.abs(u.monthly_exp - expectedExp)).toBeLessThan(5);
  });

  test('过期 monthly 卡密 → cardkey_expired', async () => {
    const res = await callAuth(EXPIRED_MONTHLY_KEY, 'fp-exp-month');
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('cardkey_expired');
    expect(json.error.message).toContain('月订');
  });

  test('monthly 设备上限 = 3', async () => {
    await callAuth(MONTHLY_KEY, 'fp-a');
    await callAuth(MONTHLY_KEY, 'fp-b');
    await callAuth(MONTHLY_KEY, 'fp-c');

    const res = await callAuth(MONTHLY_KEY, 'fp-d');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('device_limit');
  });
});

describe('lifetime plan', () => {
  test('不检查过期，monthly_exp 为 NULL 时也能登录', async () => {
    const res = await callAuth(LIFETIME_KEY, 'fp-life-1');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { plan: string; month_exp: null };
    expect(json.plan).toBe('lifetime');
    expect(json.month_exp).toBeNull();
  });

  test('设备上限 = 3', async () => {
    await callAuth(LIFETIME_KEY, 'fp-a');
    await callAuth(LIFETIME_KEY, 'fp-b');
    await callAuth(LIFETIME_KEY, 'fp-c');

    const res = await callAuth(LIFETIME_KEY, 'fp-d');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('device_limit');
  });
});

describe('通用 auth 校验', () => {
  test('无效卡密 → invalid_cardkey', async () => {
    const res = await callAuth('NSK-DOES-NOT-EXIST-99999999', 'fp-x');
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('invalid_cardkey');
  });

  test('缺少 cardkey → 400', async () => {
    const res = await ctx.fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_fingerprint: 'fp-x' }),
    });
    expect(res.status).toBe(400);
  });

  test('被封禁用户 → banned', async () => {
    // 先 seed 一个被 ban 的用户
    const bannedKey = 'NSK-BANNED-TEST-00000000000006';
    const hash = await sha256Hex(bannedKey);
    ctx.env.rawDb
      .prepare(
        `INSERT INTO users (id, cardkey_hash, plan, bound_devices, monthly_exp, created_at, is_banned)
         VALUES (?, ?, 'monthly', '[]', NULL, ?, 1)`,
      )
      .run('user-banned', hash, now);

    const res = await callAuth(bannedKey, 'fp-x');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('banned');
  });
});
