import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asR2Like, createDiskStorage } from '../src/lib/disk-storage';
import { createTestCtx, type TestCtx } from './_helpers';
import type { Env } from '../src/index';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';
let tmpDir: string;
let ctx: TestCtx;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nc-img-test-'));
  const disk = createDiskStorage(tmpDir);
  ctx = createTestCtx({
    STORAGE: asR2Like(disk) as unknown as Env['STORAGE'],
  });
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

const HEX_HASH = 'a'.repeat(64);

async function putImage(hash: string, bytes: Uint8Array): Promise<void> {
  const disk = createDiskStorage(tmpDir);
  await disk.put(`stitched/${hash}.png`, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
}

describe('GET /admin/image/:hash', () => {
  test('200 + PNG bytes 当存在', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await putImage(HEX_HASH, png);

    const res = await ctx.fetch(`/admin/image/${HEX_HASH}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe('8');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(png));
  });

  test('404 当 key 不在', async () => {
    const res = await ctx.fetch(`/admin/image/${HEX_HASH}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_found');
  });

  test('400 当 hash 不是 hex', async () => {
    const res = await ctx.fetch('/admin/image/not-hex!', {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(400);
  });

  test('403 缺 X-Admin-Key', async () => {
    const res = await ctx.fetch(`/admin/image/${HEX_HASH}`);
    expect(res.status).toBe(403);
  });

  test('503 当 STORAGE 关', async () => {
    const off = createTestCtx({ STORAGE: undefined });
    const res = await off.fetch(`/admin/image/${HEX_HASH}`, {
      headers: { 'X-Admin-Key': ADMIN_KEY },
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('storage_disabled');
  });
});
