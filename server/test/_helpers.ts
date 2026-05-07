// 测试公共工具：构造内存 sqlite + Env + 发请求到 app.fetch

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import app from '../src/index';
import { createSqliteAdapter, type D1LikeDatabase } from '../src/lib/db-sqlite-adapter';
import type { Env } from '../src/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

export interface TestCtx {
  env: Env & { rawDb: Database.Database };
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** 建一个 :memory: sqlite + apply schema + 返回可直接请求 app 的 ctx */
export function createTestCtx(overrides: Partial<Env> = {}): TestCtx {
  const rawDb = new Database(':memory:');
  rawDb.pragma('journal_mode = WAL');
  applyMigrations(rawDb);

  const env: Env & { rawDb: Database.Database } = {
    DB: createSqliteAdapter(rawDb),
    STORAGE: undefined,
    STORAGE_PUBLIC_BASE: undefined,
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
    ADMIN_KEY: 'test-admin-key-0123456789abcdef',
    DEEPSEEK_API_KEY: '',
    PROTOCOL_VERSION: '1.0.0-alpha',
    rawDb,
    ...overrides,
  };

  const executionCtx = {
    waitUntil(p: Promise<unknown>): void {
      void p.catch((err: unknown) => console.error('[test waitUntil]', err));
    },
    passThroughOnException(): void {
      /* no-op */
    },
  };

  return {
    env,
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      const url = path.startsWith('http') ? path : 'http://local' + path;
      return app.fetch(new Request(url, init), env, executionCtx as unknown as never);
    },
  };
}

function applyMigrations(db: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('seed'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
  }
}

/** D1-like 暴露给测试：直接跑 SQL 查表（seed 用户等） */
export async function rawExec(
  db: D1LikeDatabase,
  sql: string,
  ...args: unknown[]
): Promise<void> {
  await db.prepare(sql).bind(...args).run();
}
