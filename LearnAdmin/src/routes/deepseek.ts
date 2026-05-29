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
  const now = Math.floor(Date.now() / 1000);
  const monthStart = now - 30 * 86400;

  const monthAccepted = safeGet(db, 'SELECT COUNT(*) AS n FROM inference_logs WHERE ts > ? AND accepted = 1', monthStart);
  const monthTotal = safeGet(db, 'SELECT COUNT(*) AS n FROM inference_logs WHERE ts > ?', monthStart);
  const avgLatency = safeGet(db, 'SELECT AVG(latency_ms) AS avg FROM inference_logs WHERE ts > ?', monthStart);

  const daily = safeAll(db, `
    SELECT
      date(datetime(ts, 'unixepoch', 'localtime')) AS date,
      COUNT(*) AS calls,
      SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) AS accepted
    FROM inference_logs
    WHERE ts > ?
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
  `, monthStart);

  const totalN = monthTotal?.n ?? 0;
  const acceptedN = monthAccepted?.n ?? 0;
  return c.json({
    this_month_calls: totalN,
    this_month_accepted: acceptedN,
    this_month_success_rate: totalN > 0 ? Math.round((acceptedN / totalN) * 100) / 100 : 0,
    avg_latency_ms: Math.round(avgLatency?.avg ?? 0),
    daily: daily ? [...daily].reverse() : [],
  });
});

export default route;
