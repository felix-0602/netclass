import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage, asR2Like, createDiskStorage } from '../src/lib/disk-storage';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nc-disk-'));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('DiskStorage', () => {
  test('put + get 完整 round-trip', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic

    const put = await disk.put('stitched/abc123.png', data, {
      httpMetadata: { contentType: 'image/png' },
    });
    expect(put.key).toBe('stitched/abc123.png');
    expect(put.size).toBe(8);

    const got = await disk.get('stitched/abc123.png');
    expect(got).not.toBeNull();
    expect(got!.size).toBe(8);
    expect(got!.contentType).toBe('image/png');
    expect(Array.from(got!.body)).toEqual(Array.from(data));
  });

  test('get 不存在的 key → null', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    const got = await disk.get('does/not/exist.png');
    expect(got).toBeNull();
  });

  test('has 不存在 → false；存在 → true', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    expect(await disk.has('x.png')).toBe(false);
    await disk.put('x.png', new Uint8Array([1, 2, 3]));
    expect(await disk.has('x.png')).toBe(true);
  });

  test('path traversal 防护：.. 拒绝', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    await expect(disk.put('../escape.png', new Uint8Array([1]))).rejects.toThrow(/invalid key/);
    await expect(disk.get('../etc/passwd')).rejects.toThrow(/invalid key/);
  });

  test('path traversal 防护：绝对路径拒绝', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    await expect(disk.put('/abs/path.png', new Uint8Array([1]))).rejects.toThrow(/invalid key/);
  });

  test('多级目录自动建', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    await disk.put('a/b/c/d.png', new Uint8Array([0xff]));
    expect(await disk.has('a/b/c/d.png')).toBe(true);
  });

  test('asR2Like 包装后 put/get 行为不变', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    const r2 = asR2Like(disk);
    await r2.put('x.png', new Uint8Array([1, 2, 3]));
    const got = await r2.get('x.png');
    expect(got).not.toBeNull();
    expect(Array.from(got!.body)).toEqual([1, 2, 3]);
  });

  test('createDiskStorage 用 env 或默认路径', () => {
    const orig = process.env.DISK_STORAGE_PATH;
    try {
      process.env.DISK_STORAGE_PATH = tmpDir;
      const disk = createDiskStorage();
      expect(disk).toBeInstanceOf(DiskStorage);
    } finally {
      if (orig === undefined) delete process.env.DISK_STORAGE_PATH;
      else process.env.DISK_STORAGE_PATH = orig;
    }
  });

  test('content-type 推断', async () => {
    const disk = new DiskStorage({ basePath: tmpDir });
    await disk.put('x.png', new Uint8Array([1]));
    await disk.put('x.jpg', new Uint8Array([1]));
    await disk.put('x.unknown', new Uint8Array([1]));
    expect((await disk.get('x.png'))!.contentType).toBe('image/png');
    expect((await disk.get('x.jpg'))!.contentType).toBe('image/jpeg');
    expect((await disk.get('x.unknown'))!.contentType).toBe('application/octet-stream');
  });
});
