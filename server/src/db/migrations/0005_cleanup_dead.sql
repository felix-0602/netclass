-- 0005_cleanup_dead: 清理从不使用的列
-- month_inference_cost_minutes 自创建以来从不更新，移除
CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  cardkey_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','monthly','lifetime')),
  bound_devices TEXT NOT NULL DEFAULT '[]',
  monthly_exp INTEGER,
  month_reset_at INTEGER,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO users_new (id, cardkey_hash, plan, bound_devices, monthly_exp, month_reset_at, is_banned, created_at)
SELECT id, cardkey_hash, plan, bound_devices, monthly_exp, month_reset_at, is_banned, created_at
FROM users;

DROP TABLE IF EXISTS users;
ALTER TABLE users_new RENAME TO users;
