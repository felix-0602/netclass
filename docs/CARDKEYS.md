# Netclass 卡密管理

> 卡密生成、分发、升级的完整操作手册。

## 1. 三档卡密

| 档位 | plan 值 | 时效 | 设备上限 | 适用场景 |
|------|---------|------|----------|----------|
| 试用 | `trial` | 激活起 7 天 | 3 台 | 推广、体验、拉新 |
| 月订 | `monthly` | 激活起 30 天 | 3 台 | 正式付费用户 |
| 永久 | `lifetime` | 无限制 | 3 台 | 自用、长期用户 |
| 管理 | `admin` | 无限制 | 无限 | 开发者自用 |

> **关键设计**：trial/monthly 的过期倒计时从**用户首次激活**开始算，不是从生成那天算。卡密生成后放在库里一个月不激活也不会过期。

## 2. 生成卡密

```bash
cd server

# 试用卡 — 推广用
npx tsx scripts/gen-cardkeys.ts trial 30

# 月卡 — 用户付款后你手动开
npx tsx scripts/gen-cardkeys.ts monthly 5

# 永久卡 — 自用或特殊用户
npx tsx scripts/gen-cardkeys.ts lifetime 1
```

每次运行会：
1. 把卡密写入数据库 `users` 表
2. 在同目录生成 `cardkeys-YYYY-MM-DD-<plan>.md` 清单文件

## 3. 分发卡密

1. 打开清单文件（如 `cardkeys-2026-05-09-trial.md`）
2. 复制一条卡密发给用户（QQ/微信/邮件）
3. 用户按照 [INSTALL-ROOMMATE.md](../docs/INSTALL-ROOMMATE.md) §5 激活
4. 在清单里标记"已发出"

## 4. 升级卡密

把任意卡密升级为 admin（无限设备、永不过期）：

```bash
npx tsx scripts/set-admin-plan.ts NSK-XXXX-XXXXXXXX
```

查看数据库中某张卡密的状态：

```bash
npx tsx -e "
const Database = require('better-sqlite3');
const { createHash } = require('crypto');
const db = new Database('./netclass.db');
const hash = createHash('sha256').update(process.argv[1] || '').digest('hex');
const u = db.prepare('SELECT * FROM users WHERE cardkey_hash = ?').get(hash);
console.log(JSON.stringify(u, null, 2));
db.close();
" NSK-XXXX-XXXXXXXX
```

## 5. 解绑设备

卡密绑满 3 台设备后，用户换设备需要解绑：

```bash
# 清空指定卡密的所有设备绑定
npx tsx scripts/set-admin-plan.ts NSK-XXXX-XXXXXXXX
# 然后降回原 plan：
npx tsx -e "
const Database = require('better-sqlite3');
const { createHash } = require('crypto');
const db = new Database('./netclass.db');
const hash = createHash('sha256').update(process.argv[1]).digest('hex');
db.prepare(\"UPDATE users SET plan='monthly', bound_devices='[]' WHERE cardkey_hash=?\").run(hash);
db.close();
" NSK-XXXX-XXXXXXXX
```

或通过 API（curl + X-Admin-Key）：

```bash
curl -X POST http://182.254.180.181:8080/admin/unbind-device \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Key: <your-admin-key>' \
  -d '{"cardkey": "NSK-XXXX-XXXXXXXX"}'
```

## 6. 吊销卡密

封禁一张卡密：

```bash
npx tsx -e "
const Database = require('better-sqlite3');
const { createHash } = require('crypto');
const db = new Database('./netclass.db');
const hash = createHash('sha256').update(process.argv[1]).digest('hex');
const r = db.prepare('UPDATE users SET is_banned=1 WHERE cardkey_hash=?').run(hash);
console.log(r.changes ? '已封禁' : '未找到该卡密');
db.close();
" NSK-XXXX-XXXXXXXX
```

## 7. 库存查询

```bash
npx tsx -e "
const Database = require('better-sqlite3');
const db = new Database('./netclass.db');
const rows = db.prepare(\`
  SELECT plan, count(*) as total,
    sum(CASE WHEN monthly_exp IS NULL THEN 1 ELSE 0 END) as unactivated,
    sum(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) as banned
  FROM users WHERE id LIKE 'user-gen-%'
  GROUP BY plan ORDER BY plan
\`).all();
for (const r of rows) console.log(r.plan, '总计', r.total, '未激活', r.unactivated, '封禁', r.banned);
db.close();
"
```
