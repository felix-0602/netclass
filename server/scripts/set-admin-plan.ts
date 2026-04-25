// 把指定卡密升级为 admin plan（无设备数上限 + 不过期）
//
// 用法：
//   NETCLASS_CARDKEY='NSK-XXXX-XXXXXXXX' npx tsx scripts/set-admin-plan.ts
//
// 或参数形式：
//   npx tsx scripts/set-admin-plan.ts NSK-XXXX-XXXXXXXX
//
// 路径：默认 ./netclass.db，可改 NETCLASS_DB env

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

const DB_PATH = process.env.NETCLASS_DB ?? './netclass.db';
const cardkey = process.env.NETCLASS_CARDKEY ?? process.argv[2];

if (!cardkey) {
  console.error('用法: NETCLASS_CARDKEY=NSK-... npx tsx scripts/set-admin-plan.ts');
  console.error('   或 npx tsx scripts/set-admin-plan.ts NSK-...');
  process.exit(1);
}

const cardkeyHash = createHash('sha256').update(cardkey.trim()).digest('hex');

const db = new Database(DB_PATH);
const user = db
  .prepare('SELECT id, plan, bound_devices FROM users WHERE cardkey_hash = ?')
  .get(cardkeyHash) as { id: string; plan: string; bound_devices: string | null } | undefined;

if (!user) {
  console.error(`卡密未找到（hash=${cardkeyHash.slice(0, 16)}...）`);
  console.error('如果是新卡密：先去主流程激活一次，再跑本脚本');
  process.exit(1);
}

console.log(`找到用户: id=${user.id} plan=${user.plan}`);
console.log(`当前 bound_devices: ${user.bound_devices}`);

const result = db
  .prepare("UPDATE users SET plan='admin', bound_devices='[]' WHERE id = ?")
  .run(user.id);

console.log(`✅ 已升级为 admin plan + 清空设备绑定（changes=${result.changes}）`);
db.close();
