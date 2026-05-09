-- 0004_device_bindings: 独立设备绑定表，替代 JSON 数组，消除 TOCTOU 竞态
CREATE TABLE IF NOT EXISTS user_devices (
  user_id TEXT NOT NULL,
  device_fp TEXT NOT NULL,
  bound_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_fp)
);

-- 迁移现有 users 表的 bound_devices JSON 数据到新表
INSERT OR IGNORE INTO user_devices (user_id, device_fp, bound_at)
SELECT
  u.id AS user_id,
  json_each.value AS device_fp,
  u.created_at AS bound_at
FROM users u, json_each(u.bound_devices)
WHERE u.bound_devices IS NOT NULL AND u.bound_devices != '[]';
