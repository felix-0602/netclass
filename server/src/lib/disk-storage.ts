// 本地盘存储 —— Phase 0 R2 未启用时的 fallback。
//
// 模拟 R2Bucket 的子集 API（put / get），让 routes/answer.ts 现有
// `c.env.STORAGE.put(...)` 调用点不改一行。
//
// 文件落 disk 在 STORAGE_PATH 目录下，按 key 分目录（key 形如 `stitched/<hash>.png`，
// 自动建子目录）。
//
// 不是为了规模化（生产将来会换 R2 / COS），目的是让 Phase 0 单机测试时
// 数学题 composite_image 能存住，drain 能读到。

import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface DiskStorageOptions {
  basePath: string;
}

export interface DiskStorageObject {
  body: Uint8Array;
  contentType: string;
  size: number;
  key: string;
}

/**
 * R2Bucket-like：仅实现 routes/answer.ts 用到的 put + get。
 * 其它 R2 方法（list/delete/head）按需补，目前不需要。
 */
export class DiskStorage {
  constructor(private readonly opts: DiskStorageOptions) {}

  /** 完整 fs 路径 */
  private filepath(key: string): string {
    // 阻 path traversal：key 必须是相对路径，不能含 ..
    if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
      throw new Error(`disk-storage: invalid key ${key}`);
    }
    return resolve(this.opts.basePath, key);
  }

  async put(
    key: string,
    body: Uint8Array | ArrayBuffer | Buffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<{ key: string; size: number; httpMetadata?: { contentType?: string } }> {
    const fp = this.filepath(key);
    await fs.mkdir(dirname(fp), { recursive: true });
    const buf = Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : Buffer.from(new Uint8Array(body));
    await fs.writeFile(fp, buf);
    return {
      key,
      size: buf.length,
      httpMetadata: options?.httpMetadata,
    };
  }

  async get(key: string): Promise<DiskStorageObject | null> {
    try {
      const fp = this.filepath(key);
      const body = await fs.readFile(fp);
      return {
        body: new Uint8Array(body),
        contentType: guessContentType(key),
        size: body.length,
        key,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /** 是否存在某 key（drain 不下载只查在不在时用）*/
  async has(key: string): Promise<boolean> {
    try {
      await fs.stat(this.filepath(key));
      return true;
    } catch {
      return false;
    }
  }
}

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/** 把 DiskStorage 包成 routes/answer.ts 期望的 R2Bucket 子集形状 */
export function asR2Like(disk: DiskStorage): {
  put: (
    key: string,
    body: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<DiskStorageObject | null>;
} {
  return {
    put: (key, body, opts) => disk.put(key, body, opts),
    get: (key) => disk.get(key),
  };
}

/** path 解析：取相对仓库 server/ 目录的默认存储位置 */
export function defaultStoragePath(): string {
  return resolve(process.cwd(), 'storage');
}

/** 构造一个 DiskStorage 实例，从 env 或默认位置 */
export function createDiskStorage(basePath?: string): DiskStorage {
  return new DiskStorage({
    basePath: basePath ?? process.env.DISK_STORAGE_PATH ?? defaultStoragePath(),
  });
}

/** 从 key 还原 fs 路径 —— 给 admin/image 端点 stream file 用 */
export function diskStorageFilepath(disk: DiskStorage, key: string): string {
  // 手动重做一遍校验
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
    throw new Error(`disk-storage: invalid key ${key}`);
  }
  return join((disk as unknown as { opts: DiskStorageOptions }).opts.basePath, key);
}
