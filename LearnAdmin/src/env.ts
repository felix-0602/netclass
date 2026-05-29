import Database from 'better-sqlite3';
import path from 'node:path';

export interface AdminEnv {
  DB: ReturnType<typeof Database>;
  ADMIN_KEY: string;
  DB_PATH: string;
}

export function createEnv(): AdminEnv {
  const ADMIN_KEY = process.env.ADMIN_KEY ?? '';
  const DB_PATH = process.env.DB_PATH ?? path.resolve('../server/netclass.db');

  if (!ADMIN_KEY) {
    throw new Error('ADMIN_KEY is required');
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return { DB: db, ADMIN_KEY, DB_PATH };
}
