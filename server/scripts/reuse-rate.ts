// 复用率探针 —— Phase 0 退出门槛 #2 的测量工具
//
// ROADMAP 要求"同门课跨舍友题目复用率 ≥50%"。理想口径需要 inference_logs
// 表里 (user_id, question_hash) 配对（Phase 1 W2 任务 1.16 才接入），
// Phase 0 只能用 questions.hit_count 做近似 proxy：
//
//   true reuse rate    = |questions hit by ≥2 distinct users|  /  |total questions|
//   proxy reuse rate   = |questions with hit_count ≥ 2|        /  |total questions|
//
// 两者不严格相等（同一用户重复进同一页面也会涨 hit_count），但在 3 舍友
// 场景下相关性高。Phase 1 会用真口径替换。
//
// 用法：
//   tsx server/scripts/reuse-rate.ts                  # 全平台总览
//   tsx server/scripts/reuse-rate.ts --platform chaoxing
//   tsx server/scripts/reuse-rate.ts --course 262290410
//   tsx server/scripts/reuse-rate.ts --json           # JSON 输出便于对接 dashboard

import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const DB_PATH = process.env.NETCLASS_DB ?? resolve(process.cwd(), 'netclass.db');

interface Args {
  platform?: string;
  course?: string;
  json?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--platform') args.platform = argv[++i];
    else if (a === '--course') args.course = argv[++i];
    else if (a === '--json') args.json = true;
  }
  return args;
}

function buildWhere(args: Args): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (args.platform) {
    conds.push('platform = ?');
    params.push(args.platform);
  }
  if (args.course) {
    conds.push('course_sig = ?');
    params.push(args.course);
  }
  return {
    where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

interface ReuseStats {
  filter: { platform?: string; course?: string };
  total_questions: number;
  hit_count_distribution: { hit_count: number; questions: number }[];
  questions_with_2plus_hits: number;
  proxy_reuse_rate_pct: number;
  per_platform: { platform: string; total: number; reused: number; rate_pct: number }[];
  top_courses: { course_sig: string; total: number; reused: number; rate_pct: number }[];
}

function compute(db: Database.Database, args: Args): ReuseStats {
  const { where, params } = buildWhere(args);

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM questions ${where}`).get(...params) as { n: number }).n;

  const dist = db
    .prepare(
      `SELECT hit_count, COUNT(*) AS questions
       FROM questions ${where}
       GROUP BY hit_count
       ORDER BY hit_count`,
    )
    .all(...params) as { hit_count: number; questions: number }[];

  const reused = (db.prepare(`SELECT COUNT(*) AS n FROM questions ${where ? where + ' AND' : 'WHERE'} hit_count >= 2`).get(...params) as { n: number }).n;
  const proxyRate = total > 0 ? Math.round((reused / total) * 1000) / 10 : 0;

  const perPlatform = db
    .prepare(
      `SELECT platform,
              COUNT(*)                                AS total,
              SUM(CASE WHEN hit_count >= 2 THEN 1 ELSE 0 END) AS reused
       FROM questions
       GROUP BY platform`,
    )
    .all() as { platform: string; total: number; reused: number }[];
  const platforms = perPlatform.map((p) => ({
    ...p,
    rate_pct: p.total > 0 ? Math.round((p.reused / p.total) * 1000) / 10 : 0,
  }));

  const topCourses = (db
    .prepare(
      `SELECT course_sig,
              COUNT(*)                                AS total,
              SUM(CASE WHEN hit_count >= 2 THEN 1 ELSE 0 END) AS reused
       FROM questions
       WHERE course_sig IS NOT NULL AND course_sig != ''
       GROUP BY course_sig
       ORDER BY total DESC
       LIMIT 10`,
    )
    .all() as { course_sig: string; total: number; reused: number }[]).map((c) => ({
    ...c,
    rate_pct: c.total > 0 ? Math.round((c.reused / c.total) * 1000) / 10 : 0,
  }));

  return {
    filter: { platform: args.platform, course: args.course },
    total_questions: total,
    hit_count_distribution: dist,
    questions_with_2plus_hits: reused,
    proxy_reuse_rate_pct: proxyRate,
    per_platform: platforms,
    top_courses: topCourses,
  };
}

function renderHuman(s: ReuseStats): string {
  const out: string[] = [];
  out.push('=== Netclass 复用率探针（Phase 0 proxy 口径） ===');
  if (s.filter.platform) out.push(`平台过滤: ${s.filter.platform}`);
  if (s.filter.course) out.push(`课程过滤: ${s.filter.course}`);
  out.push('');
  out.push(`题目总数: ${s.total_questions}`);
  out.push(`hit_count >= 2 的题: ${s.questions_with_2plus_hits}`);
  out.push(`Proxy 复用率: ${s.proxy_reuse_rate_pct}% （Phase 0 门槛 ≥ 50%）`);
  out.push('');
  out.push('--- hit_count 分布（前 10 行）---');
  s.hit_count_distribution.slice(0, 10).forEach((d) => {
    out.push(`  hit=${d.hit_count.toString().padStart(3, ' ')}  题数=${d.questions}`);
  });
  out.push('');
  out.push('--- 平台分组 ---');
  s.per_platform.forEach((p) => {
    out.push(`  ${p.platform.padEnd(10)} 共 ${p.total}  复用 ${p.reused}  ${p.rate_pct}%`);
  });
  out.push('');
  out.push('--- Top 10 课程 ---');
  s.top_courses.forEach((c) => {
    out.push(`  ${c.course_sig.padEnd(20)} 共 ${c.total}  复用 ${c.reused}  ${c.rate_pct}%`);
  });
  out.push('');
  out.push('注：Phase 0 用 hit_count 近似复用，无法区分"同人多次"和"跨人复用"。');
  out.push('Phase 1 W2 任务 1.16 接入 inference_logs 后改用 distinct user_id 真口径。');
  return out.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const stats = compute(db, args);
    if (args.json) {
      process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
    } else {
      process.stdout.write(renderHuman(stats) + '\n');
    }
  } finally {
    db.close();
  }
}

main();
