// 批量生成卡密并写入数据库 + 输出文档
//
// 用法：
//   npx tsx scripts/gen-cardkeys.ts <plan> [count]
//
// plan: trial | monthly | lifetime
// count 默认 1
//
// 示例：
//   npx tsx scripts/gen-cardkeys.ts trial 30   → 30 张试用卡（激活起 7 天）
//   npx tsx scripts/gen-cardkeys.ts monthly 5   → 5 张月卡（激活起 30 天）
//   npx tsx scripts/gen-cardkeys.ts lifetime    → 1 张永久卡
//
// trial/monthly 的 monthly_exp 初始为 NULL，首次激活时由 /auth 写入。
// lifetime 的 monthly_exp 始终为 NULL（永不过期）。

import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VALID_PLANS = ['trial', 'monthly', 'lifetime'] as const;
type Plan = (typeof VALID_PLANS)[number];

const DB_PATH = process.env.NETCLASS_DB ?? './netclass.db';
const plan = process.argv[2]?.toLowerCase() ?? '';
const count = Math.max(1, parseInt(process.argv[3] ?? '1', 10) || 1);

if (!VALID_PLANS.includes(plan as Plan)) {
  console.error(`用法: npx tsx scripts/gen-cardkeys.ts <plan> [count]`);
  console.error(`  plan: trial | monthly | lifetime`);
  console.error(`  count: 数量，默认 1`);
  process.exit(1);
}

const PLAN_LABEL: Record<Plan, string> = { trial: '试用（7天）', monthly: '月订（30天）', lifetime: '永久' };
const PLAN_TAG: Record<Plan, string> = { trial: '试用', monthly: '月订', lifetime: '永久' };

function genSegment(len: number): string {
  return randomBytes(len * 0.75 + 1)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .replace(/[0-9]/g, (m) => String.fromCharCode(65 + parseInt(m)))
    .replace(/[a-z]/g, (m) => m.toUpperCase())
    .slice(0, len);
}

const db = new Database(DB_PATH);
const nowSec = Math.floor(Date.now() / 1000);
const cards: { cardkey: string; id: string }[] = [];

for (let i = 0; i < count; i++) {
  const cardkey = `NSK-${genSegment(8)}-${genSegment(8)}`;
  const hash = createHash('sha256').update(cardkey).digest('hex');
  const userId = `user-gen-${nowSec}-${i.toString(36)}`;

  // trial / monthly: monthly_exp = NULL 等激活时写
  // lifetime: monthly_exp = NULL 永不过期
  const monthlyExp = null;

  db.prepare(
    `INSERT OR IGNORE INTO users (id, cardkey_hash, plan, monthly_exp, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, hash, plan, monthlyExp, nowSec);

  cards.push({ cardkey, id: userId });
}

db.close();

// 生成 Markdown 文档
const today = new Date().toISOString().slice(0, 10);
const lines = [
  `# Netclass 卡密清单 — ${today}`,
  '',
  `- **数量**：${count} 张`,
  `- **类型**：${PLAN_LABEL[plan as Plan]}`,
  `- **生成时间**：${new Date().toISOString()}`,
  '',
  '| # | 卡密 | 类型 | 状态 |',
  '|---|------|------|------|',
  ...cards.map((c, i) => `| ${i + 1} | \`${c.cardkey}\` | ${PLAN_TAG[plan as Plan]} | 未激活 |`),
  '',
  '## 使用说明',
  '',
  '1. 复制卡密发给用户',
  '2. 用户在 Tampermonkey 脚本设置面板粘贴卡密，点"激活卡密"',
  '3. 每张卡密最多绑定 3 台设备',
  plan === 'trial'
    ? '4. 试用卡密从**首次激活**起算 7 天有效'
    : plan === 'monthly'
      ? '4. 月订卡密从**首次激活**起算 30 天有效'
      : '4. 永久卡密无时间限制',
  '',
  '> 管理员操作：`npx tsx scripts/set-admin-plan.ts <卡密>` 可将指定卡密升级为 admin plan（无设备上限）。',
];

const outPath = join(process.cwd(), `cardkeys-${today}-${plan}.md`);
writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(`✅ 已生成 ${count} 张 ${PLAN_TAG[plan as Plan]}卡密 → ${outPath}`);
for (const c of cards) {
  console.log(`  ${c.cardkey}`);
}
