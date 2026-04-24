// 泄漏监控 —— Phase 0 退出门槛 #3 (盗版半衰期 ≥72h) 的测量辅助
//
// 工作方式：
//   1. 你在 DB 里插入一些 canary 题目（仅给特定 seed 用户 tag，外人不该有）。
//   2. 定期（cron）跑本脚本，用 Firecrawl / Exa / 直接 curl 扫 QQ 群、豆瓣、CSDN，
//      搜这些 canary hash 或题干的指纹。一旦命中就意味着题库被转发了。
//
// Phase 0 简化：只打印 canary 题目列表 + 上次 hit 时间 + 是否"出现"在外部。
// 外部搜索接口在 Phase 1 接入 `firecrawl-mcp` 后再补；本脚本先打地基。
//
// 用法：
//   tsx server/scripts/leak-watch.ts list              # 列出所有 canary 题
//   tsx server/scripts/leak-watch.ts add <hash> <tag>  # 标记某题为 canary
//   tsx server/scripts/leak-watch.ts remove <hash>     # 取消标记

import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const DB_PATH = process.env.NETCLASS_DB ?? resolve(process.cwd(), 'netclass.db');

// canary 元信息表：轻量，不动主 schema
// 首次运行自动建
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS canary_questions (
  question_hash TEXT PRIMARY KEY,
  tag           TEXT NOT NULL,
  seeded_at     INTEGER NOT NULL,
  last_seen_external INTEGER,
  external_source    TEXT
);
`;

interface CanaryRow {
  question_hash: string;
  tag: string;
  seeded_at: number;
  last_seen_external: number | null;
  external_source: string | null;
  text: string | null;
  platform: string | null;
  hit_count: number | null;
}

function list(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT c.question_hash, c.tag, c.seeded_at,
              c.last_seen_external, c.external_source,
              q.text, q.platform, q.hit_count
         FROM canary_questions c
         LEFT JOIN questions q ON q.id = c.question_hash
         ORDER BY c.seeded_at DESC`,
    )
    .all() as CanaryRow[];

  if (rows.length === 0) {
    console.log('暂无 canary 题。用法：leak-watch add <question_hash> <tag>');
    return;
  }

  console.log(`=== ${rows.length} 个 canary 题 ===\n`);
  rows.forEach((r) => {
    const seededAgo = humanAgo((Date.now() / 1000) - r.seeded_at);
    const extSeen = r.last_seen_external
      ? `${humanAgo(Date.now() / 1000 - r.last_seen_external)} 前在 ${r.external_source}`
      : '未见泄漏';
    console.log(`  [${r.tag}] ${r.question_hash.slice(0, 16)}…`);
    console.log(`    题干: ${(r.text ?? '(未在 questions 表)').slice(0, 60)}`);
    console.log(`    平台: ${r.platform ?? '—'}   hit_count: ${r.hit_count ?? 0}`);
    console.log(`    投放: ${seededAgo} 前   外部: ${extSeen}`);
    console.log('');
  });

  // 半衰期判定
  const leaked = rows.filter((r) => r.last_seen_external !== null);
  if (leaked.length === 0) {
    console.log('✅ 全部 canary 题均未外泄，Phase 0 门槛 #3 不告警。');
  } else {
    console.log(`⚠ 已有 ${leaked.length} 个 canary 题被外部捕获。`);
    leaked.forEach((r) => {
      const hours = r.last_seen_external
        ? Math.round(((r.last_seen_external - r.seeded_at) / 3600) * 10) / 10
        : 0;
      console.log(
        `    ${r.tag} [${r.question_hash.slice(0, 12)}…] 泄漏耗时 ${hours}h（门槛 ≥72h）`,
      );
    });
  }
}

function add(db: Database.Database, hash: string, tag: string): void {
  if (!hash || !tag) {
    console.error('用法：leak-watch add <question_hash> <tag>');
    process.exit(2);
  }
  const exists = db.prepare('SELECT 1 FROM questions WHERE id = ?').get(hash);
  if (!exists) {
    console.warn(`⚠ 警告：hash ${hash} 不在 questions 表里。仍会标记，但内容未知。`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO canary_questions (question_hash, tag, seeded_at)
     VALUES (?, ?, ?)`,
  ).run(hash, tag, Math.floor(Date.now() / 1000));
  console.log(`✓ 已标记 ${hash.slice(0, 16)}… 为 canary，tag=${tag}`);
}

function remove(db: Database.Database, hash: string): void {
  const res = db.prepare('DELETE FROM canary_questions WHERE question_hash = ?').run(hash);
  console.log(res.changes > 0 ? `✓ 已取消 canary 标记` : '未找到对应 canary');
}

function humanAgo(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const db = new Database(DB_PATH);
  db.exec(INIT_SQL);
  try {
    switch (cmd) {
      case 'list':
      case undefined:
        list(db);
        break;
      case 'add':
        add(db, rest[0]!, rest[1]!);
        break;
      case 'remove':
      case 'rm':
        remove(db, rest[0]!);
        break;
      default:
        console.error(`未知命令 ${cmd}。可用：list | add | remove`);
        process.exit(2);
    }
  } finally {
    db.close();
  }
}

main();
