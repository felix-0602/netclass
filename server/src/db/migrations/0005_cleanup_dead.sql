-- 0005_cleanup_dead: 清理从未使用的表和列
-- auth_events / inference_logs 自创建以来无人写入，移除
DROP TABLE IF EXISTS auth_events;
DROP TABLE IF EXISTS inference_logs;

-- month_inference_cost_minutes 从不更新，移除列
-- (SQLite 不支持 DROP COLUMN 直接删，重建表)
CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  cardkey_hash TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','monthly','lifetime')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  bound_devices TEXT NOT NULL DEFAULT '[]',
  trial_quota_hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_auth_at INTEGER NOT NULL,
  expires_at INTEGER
);

INSERT INTO users_new (id, cardkey_hash, plan, status, bound_devices, trial_quota_hits, created_at, last_auth_at, expires_at)
SELECT id, cardkey_hash, plan, status, bound_devices, trial_quota_hits, created_at, last_auth_at, expires_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
