-- Netclass Sidekick — initial schema v1.0.0-alpha
-- 对齐 docs/PROTOCOL.md §4

-- 题库主表
CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,
  platform       TEXT NOT NULL,
  q_type         TEXT NOT NULL,
  text           TEXT NOT NULL,
  options_json   TEXT,
  tex_spans_json TEXT,
  image_key      TEXT,
  course_sig     TEXT,
  answer_json    TEXT NOT NULL,
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL,
  verified_by    TEXT,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  first_seen     INTEGER NOT NULL,
  last_hit       INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_q_course_sig ON questions(course_sig);
CREATE INDEX IF NOT EXISTS idx_q_last_hit   ON questions(last_hit);
CREATE INDEX IF NOT EXISTS idx_q_platform   ON questions(platform);

-- 待处理队列
CREATE TABLE IF NOT EXISTS pending_q (
  id             TEXT PRIMARY KEY,
  platform       TEXT NOT NULL,
  q_type         TEXT NOT NULL,
  text           TEXT NOT NULL,
  options_json   TEXT,
  tex_spans_json TEXT,
  image_key      TEXT,
  context_json   TEXT,
  priority       INTEGER NOT NULL DEFAULT 5,
  attempts       INTEGER NOT NULL DEFAULT 0,
  submitted_by   TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pq_priority ON pending_q(priority DESC, created_at ASC);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  cardkey_hash   TEXT NOT NULL UNIQUE,
  plan           TEXT NOT NULL,
  bound_devices  TEXT,
  monthly_exp    INTEGER,
  month_inference_cost_minutes INTEGER NOT NULL DEFAULT 0,
  month_reset_at INTEGER,
  is_banned      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_u_cardkey_hash ON users(cardkey_hash);

-- 用户贡献队列
CREATE TABLE IF NOT EXISTS contributions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  question_hash     TEXT NOT NULL,
  text              TEXT NOT NULL,
  options_json      TEXT,
  image_key         TEXT,
  submitted_answer  TEXT NOT NULL,
  user_confidence   TEXT NOT NULL,
  user_note         TEXT,
  status            TEXT NOT NULL,
  reviewed_by       TEXT,
  review_note       TEXT,
  created_at        INTEGER NOT NULL,
  reviewed_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_c_status ON contributions(status);
CREATE INDEX IF NOT EXISTS idx_c_user   ON contributions(user_id);

-- 鉴权事件
CREATE TABLE IF NOT EXISTS auth_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  event      TEXT NOT NULL,
  ip         TEXT,
  device_fp  TEXT,
  ua         TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ae_user ON auth_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ae_ts   ON auth_events(ts);

-- 推理日志
CREATE TABLE IF NOT EXISTS inference_logs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,
  question_hash  TEXT NOT NULL,
  model          TEXT NOT NULL,
  latency_ms     INTEGER,
  accepted       INTEGER NOT NULL DEFAULT 1,
  ts             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_il_user ON inference_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_il_ts   ON inference_logs(ts);
