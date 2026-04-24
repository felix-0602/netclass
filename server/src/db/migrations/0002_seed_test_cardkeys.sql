-- Phase 0 — Seed 测试卡密（你 + 3 舍友）
-- cardkey 明文：NSK-TEST-0001 ~ NSK-TEST-0005
-- cardkey_hash = sha256(明文)
--
-- 生成方式（本地执行）：
--   node -e "require('crypto').createHash('sha256').update('NSK-TEST-0001').digest('hex')"
-- 得到 hex 填进 INSERT

-- NSK-TEST-0001 永久
INSERT OR IGNORE INTO users (id, cardkey_hash, plan, monthly_exp, created_at)
VALUES (
  'user-seed-0001',
  '64ed9b6d3c35f68f14a26c2c44a63ae4a9b7a5e6f1b5acea0fb42f80e05fb0e2', -- placeholder sha256，部署前用 node 重算
  'lifetime',
  NULL,
  strftime('%s', 'now')
);

-- NSK-TEST-0002 月订
INSERT OR IGNORE INTO users (id, cardkey_hash, plan, monthly_exp, created_at)
VALUES (
  'user-seed-0002',
  '11111111111111111111111111111111111111111111111111111111111111', -- placeholder
  'monthly',
  strftime('%s', 'now', '+30 days'),
  strftime('%s', 'now')
);

-- 其他测试卡密同理，Phase 0 跑通后再批量 seed
