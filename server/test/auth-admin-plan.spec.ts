import { beforeEach, describe, expect, test } from 'vitest';
import { sha256Hex } from '../src/lib/auth';
import { createTestCtx, type TestCtx } from './_helpers';

const ADMIN_CARDKEY = 'NSK-ADMIN-TEST-CARDKEY-00000001';
const REGULAR_CARDKEY = 'NSK-REGULAR-TEST-CARDKEY-0000002';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = createTestCtx();
  const now = Math.floor(Date.now() / 1000);
  // admin 用户：plan=admin，已绑定 5 个设备（超过普通限制 3）
  const adminHash = await sha256Hex(ADMIN_CARDKEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, created_at)
       VALUES (?, ?, 'admin', ?, ?)`,
    )
    .run('user-admin', adminHash, JSON.stringify(['fp-1', 'fp-2', 'fp-3', 'fp-4', 'fp-5']), now);

  // 普通 lifetime 用户：3 个设备已满
  const regularHash = await sha256Hex(REGULAR_CARDKEY);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, created_at)
       VALUES (?, ?, 'lifetime', ?, ?)`,
    )
    .run('user-regular', regularHash, JSON.stringify(['fp-a', 'fp-b', 'fp-c']), now);
});

async function callAuth(cardkey: string, fp: string): Promise<Response> {
  return ctx.fetch('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardkey, device_fingerprint: fp }),
  });
}

describe('auth admin plan', () => {
  test('admin plan: 已绑 5 设备时新设备仍能登录（无设备数上限）', async () => {
    const res = await callAuth(ADMIN_CARDKEY, 'fp-new-device-6');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { plan: string; jwt: string };
    expect(json.plan).toBe('admin');
    expect(json.jwt).toBeTruthy();

    // 数据库应该把新设备加进去（共 6 个）
    const u = ctx.env.rawDb
      .prepare('SELECT bound_devices FROM users WHERE id = ?')
      .get('user-admin') as { bound_devices: string };
    const devices = JSON.parse(u.bound_devices);
    expect(devices).toHaveLength(6);
    expect(devices).toContain('fp-new-device-6');
  });

  test('lifetime plan: 已绑 3 设备时新设备返 device_limit', async () => {
    const res = await callAuth(REGULAR_CARDKEY, 'fp-new-device');
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('device_limit');

    // 设备列表不变
    const u = ctx.env.rawDb
      .prepare('SELECT bound_devices FROM users WHERE id = ?')
      .get('user-regular') as { bound_devices: string };
    const devices = JSON.parse(u.bound_devices);
    expect(devices).toHaveLength(3);
  });

  test('lifetime plan: 已绑设备 fp 复用不增加列表', async () => {
    const res = await callAuth(REGULAR_CARDKEY, 'fp-a');
    expect(res.status).toBe(200);
    const u = ctx.env.rawDb
      .prepare('SELECT bound_devices FROM users WHERE id = ?')
      .get('user-regular') as { bound_devices: string };
    expect(JSON.parse(u.bound_devices)).toHaveLength(3);
  });
});
