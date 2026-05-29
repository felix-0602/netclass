import { Hono } from 'hono';
import type { AdminEnv } from '../env';

const route = new Hono<{ Bindings: AdminEnv }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeGet(db: any, sql: string, ...bind: unknown[]) {
  try { return db.prepare(sql).get(...bind) as Record<string, number> | undefined; }
  catch { return undefined; }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeAll(db: any, sql: string, ...bind: unknown[]) {
  try { return db.prepare(sql).all(...bind) as Array<Record<string, number | string>> | undefined; }
  catch { return undefined; }
}

route.get('/', (c) => {
  const db = c.env.DB;

  const questionsTotal = safeGet(db, 'SELECT COUNT(*) AS n FROM questions');
  const questionsVerified = safeGet(db, "SELECT COUNT(*) AS n FROM questions WHERE is_verified = 1");
  const questionsWrong = safeGet(db, 'SELECT COUNT(*) AS n FROM wrong_answers WHERE reviewed = 0');
  const pendingCount = safeGet(db, 'SELECT COUNT(*) AS n FROM pending_q');
  const usersTotal = safeGet(db, 'SELECT COUNT(*) AS n FROM users');

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;
  const hits24h = safeGet(db, 'SELECT COUNT(*) AS n FROM questions WHERE last_hit > ?', dayAgo);
  const answers24h = safeGet(db, 'SELECT COUNT(*) AS n FROM inference_logs WHERE ts > ?', dayAgo);

  const answersN = answers24h?.n ?? 0;
  const hitsN = hits24h?.n ?? 0;
  const hitRate24h = answersN > 0 ? hitsN / (hitsN + answersN) : 0;

  const confLow = safeGet(db, 'SELECT COUNT(*) AS n FROM questions WHERE confidence < 0.5');
  const confMid = safeGet(db, 'SELECT COUNT(*) AS n FROM questions WHERE confidence >= 0.5 AND confidence < 0.8');
  const confHigh = safeGet(db, 'SELECT COUNT(*) AS n FROM questions WHERE confidence >= 0.8');

  const platforms = safeAll(db, 'SELECT platform, COUNT(*) AS n FROM questions GROUP BY platform ORDER BY n DESC');
  const types = safeAll(db, 'SELECT q_type, COUNT(*) AS n FROM questions GROUP BY q_type ORDER BY n DESC');

  return c.json({
    questions_total: questionsTotal?.n ?? 0,
    questions_verified: questionsVerified?.n ?? 0,
    questions_wrong: questionsWrong?.n ?? 0,
    pending_count: pendingCount?.n ?? 0,
    users_total: usersTotal?.n ?? 0,
    hit_rate_24h: Math.round(hitRate24h * 100) / 100,
    confidence_distribution: {
      low: confLow?.n ?? 0,
      mid: confMid?.n ?? 0,
      high: confHigh?.n ?? 0,
    },
    platforms: platforms
      ? Object.fromEntries(platforms.map((p) => [p.platform, p.n]))
      : {},
    types: types
      ? Object.fromEntries(types.map((t) => [t.q_type, t.n]))
      : {},
  });
});

export default route;
