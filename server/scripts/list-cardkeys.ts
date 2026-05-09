// 查看所有卡密状态
// 用法：
//   npx tsx scripts/list-cardkeys.ts           → 全部
//   npx tsx scripts/list-cardkeys.ts trial     → 只看试用
//   npx tsx scripts/list-cardkeys.ts monthly   → 只看月卡
//   npx tsx scripts/list-cardkeys.ts lifetime  → 只看永久
//   npx tsx scripts/list-cardkeys.ts admin     → 只看管理

import Database from 'better-sqlite3';

const DB_PATH = process.env.NETCLASS_DB ?? './netclass.db';
const filterPlan = process.argv[2]?.toLowerCase() ?? '';

const db = new Database(DB_PATH);

let query = 'SELECT id, plan, bound_devices, monthly_exp, is_banned, created_at FROM users';
const params: string[] = [];
if (filterPlan && ['trial', 'monthly', 'lifetime', 'admin'].includes(filterPlan)) {
  query += ' WHERE plan = ?';
  params.push(filterPlan);
}
query += ' ORDER BY plan, created_at DESC';

const rows = db.prepare(query).all(...params) as Array<{
  id: string;
  plan: string;
  bound_devices: string | null;
  monthly_exp: number | null;
  is_banned: number;
  created_at: number;
}>;

if (rows.length === 0) {
  console.log('没有卡密。');
  db.close();
  process.exit(0);
}

const now = Math.floor(Date.now() / 1000);
const planLabel: Record<string, string> = { trial: '试用', monthly: '月订', lifetime: '永久', admin: '管理' };

console.log(`共 ${rows.length} 张卡密${filterPlan ? `（${planLabel[filterPlan] ?? filterPlan}）` : ''}：\n`);

// 表头
console.log(
  [
    pad('ID（截取）', 24),
    pad('类型', 6),
    pad('设备', 6),
    pad('状态', 10),
    pad('过期时间', 21),
    pad('生成时间', 21),
  ].join(''),
);

console.log('-'.repeat(90));

for (const r of rows) {
  const devices = r.bound_devices ? JSON.parse(r.bound_devices) as string[] : [];
  const devCount = devices.length;

  let status: string;
  if (r.is_banned) {
    status = '❌ 封禁';
  } else if (r.plan === 'trial' || r.plan === 'monthly') {
    if (r.monthly_exp == null) {
      status = '⏳ 未激活';
    } else if (r.monthly_exp < now) {
      status = '⏰ 已过期';
    } else {
      status = '✅ 有效';
    }
  } else {
    status = '✅ 有效';
  }

  const expStr = r.monthly_exp
    ? new Date(r.monthly_exp * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : '-';
  const createdStr = new Date(r.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19);

  console.log(
    [
      pad(r.id.slice(-20), 24),
      pad(planLabel[r.plan] ?? r.plan, 6),
      pad(String(devCount) + '/3', 6),
      pad(status, 10),
      pad(expStr, 21),
      pad(createdStr, 21),
    ].join(''),
  );
}

db.close();

// 统计
const active = rows.filter((r) => !r.is_banned && (r.plan === 'lifetime' || r.plan === 'admin' || (r.monthly_exp != null && r.monthly_exp >= now))).length;
const unactivated = rows.filter((r) => r.monthly_exp == null && !r.is_banned && (r.plan === 'trial' || r.plan === 'monthly')).length;
const expired = rows.filter((r) => !r.is_banned && r.monthly_exp != null && r.monthly_exp < now && (r.plan === 'trial' || r.plan === 'monthly')).length;
const banned = rows.filter((r) => r.is_banned).length;

console.log(`\n有效 ${active} | 未激活 ${unactivated} | 过期 ${expired} | 封禁 ${banned}`);

function pad(s: string, w: number): string {
  // 中文占 2 列宽度
  let len = 0;
  for (const ch of s) {
    len += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return s + ' '.repeat(Math.max(0, w - len));
}
