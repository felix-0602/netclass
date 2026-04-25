// 重算 questions 和 pending_q 表的 id（hash）
//
// 触发场景：hash 算法变更（v1 → v2 加 options 按 label 排序）
// 后向兼容：旧 row 的 id 是旧 hash，新 client 算的是新 hash → 永远 miss
// 方案：遍历所有行，按当前最新 hashQuestion() 重算 id，INSERT 新行 + DELETE 旧行
//
// 用法（在 server 目录跑）：
//   npx tsx scripts/rehash-id.ts                 # dry-run，只打印会变多少行
//   npx tsx scripts/rehash-id.ts --commit        # 真改
//
// 路径：默认 ./netclass.db，可改 NETCLASS_DB env

import Database from 'better-sqlite3';
import { hashQuestion } from '../src/lib/hash';
import type { ExtractedQuestionLike } from '../src/lib/types';

const DB_PATH = process.env.NETCLASS_DB ?? './netclass.db';
const COMMIT = process.argv.includes('--commit');

interface QRow {
  id: string;
  platform: string;
  q_type: string;
  text: string;
  options_json: string;
  tex_spans_json: string;
}

async function rehashTable(
  db: Database.Database,
  table: 'questions' | 'pending_q',
): Promise<{ scanned: number; changed: number; collisions: number; deleted: number; inserted: number }> {
  const rows = db
    .prepare(`SELECT * FROM ${table}`)
    .all() as Array<QRow & Record<string, unknown>>;

  let changed = 0;
  let collisions = 0;
  let deleted = 0;
  let inserted = 0;

  for (const row of rows) {
    const q: ExtractedQuestionLike = {
      platform: row.platform as ExtractedQuestionLike['platform'],
      type: row.q_type as ExtractedQuestionLike['type'],
      text: row.text,
      options: JSON.parse(row.options_json ?? '[]'),
      tex_spans: JSON.parse(row.tex_spans_json ?? '[]'),
    };
    const newId = await hashQuestion(q);

    if (newId === row.id) continue;
    changed++;

    if (!COMMIT) continue;

    // 检查目标 id 是否已存在（碰撞）
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(newId);
    if (exists) {
      collisions++;
      // 旧行删掉（新行已存在，相同内容用新 hash 已经在了）
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
      deleted++;
      continue;
    }

    // INSERT 新行（同 row 数据但 id 换成 newId）
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(',');
    const newRow = { ...row, id: newId };
    const values = cols.map((c) => (newRow as Record<string, unknown>)[c]);
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
    inserted++;

    // 删旧行
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
    deleted++;
  }

  return { scanned: rows.length, changed, collisions, deleted, inserted };
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log(`[rehash-id] db=${DB_PATH} commit=${COMMIT}`);

  if (COMMIT) {
    db.prepare('BEGIN').run();
  }

  try {
    for (const table of ['questions', 'pending_q'] as const) {
      const stats = await rehashTable(db, table);
      console.log(
        `[${table}] scanned=${stats.scanned} changed=${stats.changed} collisions=${stats.collisions} inserted=${stats.inserted} deleted=${stats.deleted}`,
      );
    }
    if (COMMIT) {
      db.prepare('COMMIT').run();
      console.log('[rehash-id] committed');
    } else {
      console.log('[rehash-id] dry-run finished — pass --commit to actually rewrite');
    }
  } catch (e) {
    if (COMMIT) db.prepare('ROLLBACK').run();
    throw e;
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
