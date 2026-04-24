// 进程级单例：从 process.env 读配置，建 sqlite 实例
// 测试里用 createEnv(overrides) 注入 :memory: sqlite 便于隔离

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from './index.js';
import { createSqliteAdapter } from './lib/db-sqlite-adapter.js';

export interface EnvOverrides {
  JWT_SECRET?: string;
  ADMIN_KEY?: string;
  PROTOCOL_VERSION?: string;
  DB_PATH?: string; // ':memory:' 或文件路径
  PORT?: number;
}

export interface RuntimeEnv extends Env {
  PORT: number;
}

/**
 * 创建 Env 实例。
 * 生产走 process.env，测试传 overrides。
 */
export function createEnv(overrides: EnvOverrides = {}): RuntimeEnv {
  const JWT_SECRET = overrides.JWT_SECRET ?? process.env.JWT_SECRET ?? '';
  const ADMIN_KEY = overrides.ADMIN_KEY ?? process.env.ADMIN_KEY ?? '';
  const PROTOCOL_VERSION =
    overrides.PROTOCOL_VERSION ?? process.env.PROTOCOL_VERSION ?? '1.0.0-alpha';
  const DB_PATH = overrides.DB_PATH ?? process.env.DB_PATH ?? './netclass.db';
  const PORT = overrides.PORT ?? Number(process.env.PORT ?? 8080);

  if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
    throw new Error('JWT_SECRET is required (set in .env or pass via overrides)');
  }
  if (!ADMIN_KEY && process.env.NODE_ENV !== 'test') {
    throw new Error('ADMIN_KEY is required');
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return {
    DB: createSqliteAdapter(sqlite) as unknown as Env['DB'],
    STORAGE: undefined, // Phase 0 不用 R2，也不用 fs-bucket
    STORAGE_PUBLIC_BASE: undefined,
    JWT_SECRET,
    ADMIN_KEY,
    PROTOCOL_VERSION,
    PORT,
  };
}

/** 给测试用：切到 :memory: 并给 JWT_SECRET / ADMIN_KEY 默认值 */
export function createTestEnv(overrides: EnvOverrides = {}): RuntimeEnv {
  return createEnv({
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
    ADMIN_KEY: 'test-admin-key-0123456789abcdef',
    PROTOCOL_VERSION: '1.0.0-alpha',
    DB_PATH: ':memory:',
    ...overrides,
  });
}

// 启用 path+fileURLToPath 的 import（若将来用到）
void path;
void fileURLToPath;
