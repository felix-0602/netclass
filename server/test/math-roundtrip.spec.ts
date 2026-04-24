// Math 闭环 round-trip：
//   1. 客户端调 /answer，body 带 composite_image_b64
//   2. 服务端 miss → 把 base64 解码存进 STORAGE（disk fallback）
//   3. 服务端写 pending_q（含 image_key）
//   4. drain（模拟）调 /admin/image/<hash> 拉图
//   5. drain 调 /admin/submit 写答案
//   6. 客户端再调 /answer 同 hash → 命中

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signJwt } from '../src/lib/jwt';
import { sha256Hex } from '../src/lib/auth';
import { hashQuestion } from '../src/lib/hash';
import { asR2Like, createDiskStorage } from '../src/lib/disk-storage';
import { createTestCtx, type TestCtx } from './_helpers';
import type { Env } from '../src/index';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';
const DEVICE_FP = 'math-test-device';

const Q = {
  platform: 'chaoxing' as const,
  type: 'single' as const,
  text: '已知微分方程 <<M1>> 的通解为 <<M2>>，求特解。',
  options: [
    { label: 'A', text: 'y=x²+1', image_ref: null },
    { label: 'B', text: 'y=x²-1', image_ref: null },
    { label: 'C', text: 'y=x²', image_ref: null },
    { label: 'D', text: '其他', image_ref: null },
  ],
  tex_spans: [
    { placeholder: '<<M1>>', latex: null, image_idx: 0 },
    { placeholder: '<<M2>>', latex: null, image_idx: 1 },
  ],
  context: { course_id: 'math-101', knowledge_id: 'ch-7-1' },
};

let tmpDir: string;
let ctx: TestCtx;
let jwt: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nc-math-'));
  const disk = createDiskStorage(tmpDir);
  ctx = createTestCtx({
    STORAGE: asR2Like(disk) as unknown as Env['STORAGE'],
  });
  // seed user
  const cardkey = 'NSK-MATH-TEST-CARDKEY-00000000';
  const cardkey_hash = await sha256Hex(cardkey);
  ctx.env.rawDb
    .prepare(
      `INSERT INTO users (id, cardkey_hash, plan, bound_devices, created_at)
       VALUES (?, ?, 'lifetime', ?, ?)`,
    )
    .run('user-math-1', cardkey_hash, JSON.stringify([DEVICE_FP]), Math.floor(Date.now() / 1000));
  // sign JWT
  const fp = await sha256Hex(DEVICE_FP);
  jwt = await signJwt(
    { sub: 'user-math-1', plan: 'lifetime', exp: Math.floor(Date.now() / 1000) + 3600, fp },
    ctx.env.JWT_SECRET,
  );
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('Math 闭环 round-trip', () => {
  test('完整链路：client 上传图 → 服务端落盘 → drain 拉图 → drain 写答 → 下次 client 命中', async () => {
    const hash = await hashQuestion(Q);

    // 1. 假合成图：8 字节 PNG magic
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // base64 编码
    const base64 = Buffer.from(fakePng).toString('base64');

    // 2. client 第一次 /answer，带 composite_image_b64
    const resp1 = await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Client-Version': '0.1.0-alpha',
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({
        ...Q,
        hash,
        composite_image_b64: base64,
      }),
    });
    expect(resp1.status).toBe(202);
    const json1 = (await resp1.json()) as { status: string };
    expect(json1.status).toBe('pending');

    // 3. 服务端应已写 pending_q + image_key 指向 stitched/<hash>.png
    const pending = ctx.env.rawDb
      .prepare('SELECT image_key FROM pending_q WHERE id = ?')
      .get(hash) as { image_key: string | null };
    expect(pending.image_key).toBe(`stitched/${hash}.png`);

    // 4. drain 模拟：GET /admin/image/<hash> 应能拉到原图
    const imgResp = await ctx.fetch(`/admin/image/${hash}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(imgResp.status).toBe(200);
    expect(imgResp.headers.get('content-type')).toBe('image/png');
    const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
    expect(Array.from(imgBytes)).toEqual(Array.from(fakePng));

    // 5. drain 模拟：POST /admin/submit 写答
    const submitResp = await ctx.fetch('/admin/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_KEY,
      },
      body: JSON.stringify({
        answers: [
          {
            id: hash,
            answer: { value: 'A', raw: ['A'] },
            confidence: 0.9,
            source: 'cc_drain',
          },
        ],
      }),
    });
    expect(submitResp.status).toBe(200);
    const submitJson = (await submitResp.json()) as { accepted: number };
    expect(submitJson.accepted).toBe(1);

    // 6. client 第二次 /answer 同 hash → 命中
    const resp2 = await ctx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Client-Version': '0.1.0-alpha',
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({ ...Q, hash }),
    });
    expect(resp2.status).toBe(200);
    const json2 = (await resp2.json()) as {
      status: string;
      answer: { value: string; raw: string[] };
    };
    expect(json2.status).toBe('hit');
    expect(json2.answer.raw).toEqual(['A']);
  });

  test('未启用 STORAGE 时，composite_image_b64 被丢弃但 pending 仍写入', async () => {
    const hash = await hashQuestion(Q);
    const noStorageCtx = createTestCtx({ STORAGE: undefined });
    // seed 同样
    const cardkey_hash = await sha256Hex('NSK-MATH-TEST-CARDKEY-00000000');
    noStorageCtx.env.rawDb
      .prepare(
        `INSERT INTO users (id, cardkey_hash, plan, bound_devices, created_at)
         VALUES (?, ?, 'lifetime', ?, ?)`,
      )
      .run('user-math-1', cardkey_hash, JSON.stringify([DEVICE_FP]), Math.floor(Date.now() / 1000));
    const fp = await sha256Hex(DEVICE_FP);
    const jwt2 = await signJwt(
      { sub: 'user-math-1', plan: 'lifetime', exp: Math.floor(Date.now() / 1000) + 3600, fp },
      noStorageCtx.env.JWT_SECRET,
    );

    const resp = await noStorageCtx.fetch('/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt2}`,
        'X-Client-Version': '0.1.0-alpha',
        'X-Device-Fingerprint': DEVICE_FP,
      },
      body: JSON.stringify({
        ...Q,
        hash,
        composite_image_b64: Buffer.from([0x89, 0x50]).toString('base64'),
      }),
    });
    expect(resp.status).toBe(202);
    expect((await resp.json() as { status: string }).status).toBe('pending');

    // pending 写了，但 image_key 应为 null（STORAGE 关，图片丢）
    const pending = noStorageCtx.env.rawDb
      .prepare('SELECT image_key FROM pending_q WHERE id = ?')
      .get(hash) as { image_key: string | null };
    expect(pending.image_key).toBeNull();
  });
});
