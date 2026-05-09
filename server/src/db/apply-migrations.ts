#!/usr/bin/env tsx
// CLI：对 sqlite 数据库应用 migrations。
// 用法：
//   npm run db:migrate                      → ./netclass.db（默认）
//   DB_PATH=/var/lib/netclass/db.sqlite npm run db:migrate
//   DB_PATH=:memory: tsx src/db/apply-migrations.ts  → 内存测试

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH ?? './netclass.db';
const migrationsDir = __dirname + '/migrations';

// 只拿 schema 类迁移，seed 文件走单独 scripts/seed.ts
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql') && !f.includes('seed'))
  .sort();

if (files.length === 0) {
  console.error('未找到任何 .sql 迁移文件');
  process.exit(1);
}

console.log(`[migrate] 目标数据库: ${dbPath}`);
console.log(`[migrate] 找到 ${files.length} 个迁移文件`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 简易迁移追踪表
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`);

const applied = new Set(
  db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
);

let newCount = 0;
for (const f of files) {
  if (applied.has(f)) {
    console.log(`[migrate] 跳过（已应用）: ${f}`);
    continue;
  }
  const sql = readFileSync(join(migrationsDir, f), 'utf8');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
      .run(f, Math.floor(Date.now() / 1000));
    console.log(`[migrate] ✅ 已应用: ${f}`);
    newCount++;
  } catch (err) {
    const msg = (err as Error).message;
    // SQLite 不支持 ADD COLUMN IF NOT EXISTS — "duplicate column" 说明 schema 已最新，安全跳过
    if (msg.includes('duplicate column name') || msg.includes('already exists')) {
      db.prepare('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)')
        .run(f, Math.floor(Date.now() / 1000));
      console.log(`[migrate] ⏭ 跳过（schema 已存在）: ${f}`);
      newCount++;
      continue;
    }
    console.error(`[migrate] ❌ 失败 ${f}:`, msg);
    db.close();
    process.exit(1);
  }
}

db.close();
console.log(`[migrate] 完成。新应用 ${newCount}，总计 ${files.length}`);

// 防 TS "file is not a module"
export {};
void join;
