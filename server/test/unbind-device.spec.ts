import { beforeEach, describe, expect, test } from 'vitest';
import { sha256Hex } from '../src/lib/auth';
import { createTestCtx, type TestCtx } from './_helpers';

const CARDKEY = 'NSK-TEST-UNBIND-CARDKEY-12345678';
const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = createTestCtx();
  // seed 一个 lifetime 用户，绑了 3 个设备
  const cardkey_hash = await sha256Hex(CARDKEY);
  const now = Math.floor(Date.now() / 1000);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, created_at)
       VALUES (?, ?, 'lifetime', ?, ?)`,
    )
    .run('user-test-1', cardkey_hash, JSON.stringify(['fp-a', 'fp-b', 'fp-c']), now);
});

async function callUnbind(body: object): Promise<Response> {
  return ctx.fetch('/admin/unbind-device', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': ADMIN_KEY,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /admin/unbind-device', () => {
  test('清空全部设备（不带 device_fingerprint）', async () => {
    const res = await callUnbind({ cardkey: CARDKEY });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      user_id: string;
      plan: string;
      before: number;
      after: number;
      removed: string[];
    };
    expect(json.user_id).toBe('user-test-1');
    expect(json.plan).toBe('lifetime');
    expect(json.before).toBe(3);
    expect(json.after).toBe(0);
    expect(json.removed.sort()).toEqual(['fp-a', 'fp-b', 'fp-c']);

    // DB 验证
    const after = ctx.env.rawDb
      .prepare('SELECT bound_devices FROM users WHERE id = ?')
      .get('user-test-1') as { bound_devices: string };
    expect(JSON.parse(after.bound_devices)).toEqual([]);
  });

  test('精确解绑某一个设备', async () => {
    const res = await callUnbind({ cardkey: CARDKEY, device_fingerprint: 'fp-b' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      before: number;
      after: number;
      removed: string[];
    };
    expect(json.before).toBe(3);
    expect(json.after).toBe(2);
    expect(json.removed).toEqual(['fp-b']);

    const after = ctx.env.rawDb
      .prepare('SELECT bound_devices FROM users WHERE id = ?')
      .get('user-test-1') as { bound_devices: string };
    expect(JSON.parse(after.bound_devices).sort()).toEqual(['fp-a', 'fp-c']);
  });

  test('解绑不存在的 device_fingerprint —— idempotent no-op', async () => {
    const res = await callUnbind({ cardkey: CARDKEY, device_fingerprint: 'fp-nonexistent' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      before: number;
      after: number;
      removed: string[];
      note?: string;
    };
    expect(json.before).toBe(3);
    expect(json.after).toBe(3);
    expect(json.removed).toEqual([]);
    expect(json.note).toMatch(/idempotent/);
  });

  test('cardkey_hash 直接传入也行', async () => {
    const cardkey_hash = await sha256Hex(CARDKEY);
    const res = await callUnbind({ cardkey_hash });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { after: number };
    expect(json.after).toBe(0);
  });

  test('cardkey 和 cardkey_hash 都没传 → 400', async () => {
    const res = await callUnbind({});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('missing_fields');
  });

  test('未注册的卡密 → 404', async () => {
    const res = await callUnbind({ cardkey: 'NSK-NOT-EXIST-99999999-99999999' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_found');
  });

  test('缺 X-Admin-Key → 403', async () => {
    const res = await ctx.fetch('/admin/unbind-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardkey: CARDKEY }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('admin_required');
  });

  test('错的 X-Admin-Key → 403', async () => {
    const res = await ctx.fetch('/admin/unbind-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'WRONG' },
      body: JSON.stringify({ cardkey: CARDKEY }),
    });
    expect(res.status).toBe(403);
  });

  test('空 bound_devices 用户：清空 = 仍是空（0 changes）', async () => {
    // 改 seed 数据：bound_devices 为 null
    ctx.env.rawDb
      .prepare('UPDATE users SET bound_devices = NULL WHERE id = ?')
      .run('user-test-1');

    const res = await callUnbind({ cardkey: CARDKEY });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { before: number; after: number; removed: string[] };
    expect(json.before).toBe(0);
    expect(json.after).toBe(0);
    expect(json.removed).toEqual([]);
  });
});
