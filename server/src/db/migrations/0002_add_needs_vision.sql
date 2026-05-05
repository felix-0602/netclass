-- 0002: pending_q 加 needs_vision 标记
-- drain worker 用这个字段优先筛出"必须看图才能答"的题（公式图无 LaTeX 源）
ALTER TABLE pending_q ADD COLUMN needs_vision INTEGER NOT NULL DEFAULT 0;
