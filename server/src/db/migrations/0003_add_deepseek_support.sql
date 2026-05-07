-- 0003: DeepSeek 实时作答支持
-- is_verified: NULL=未验证, 1=正确(题库), 0=错误(需重答)
-- wrong_answers: 错题审计表

ALTER TABLE questions ADD COLUMN is_verified INTEGER;

CREATE TABLE IF NOT EXISTS wrong_answers (
  id             TEXT PRIMARY KEY,
  question_hash  TEXT NOT NULL,
  platform       TEXT NOT NULL,
  q_type         TEXT NOT NULL,
  text           TEXT NOT NULL,
  options_json   TEXT,
  tex_spans_json TEXT,
  answer_json    TEXT NOT NULL,
  confidence     REAL NOT NULL,
  source         TEXT NOT NULL,
  submitted_by   TEXT,
  reviewed       INTEGER NOT NULL DEFAULT 0,
  review_note    TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_question_hash ON wrong_answers(question_hash);
CREATE INDEX IF NOT EXISTS idx_wa_reviewed ON wrong_answers(reviewed);
CREATE INDEX IF NOT EXISTS idx_wa_created ON wrong_answers(created_at);
