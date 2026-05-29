import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AdminEnv } from './env';
import { DASHBOARD_HTML } from './dashboard.html';
import statsRoute from './routes/stats';
import usersRoute from './routes/users';
import cardkeysRoute from './routes/cardkeys';
import deepseekRoute from './routes/deepseek';
import { requireAdmin } from './lib/auth';

const app = new Hono<{ Bindings: AdminEnv }>();

app.use('*', cors());

// Dashboard 页面
app.get('/', (c) => c.html(DASHBOARD_HTML));
app.get('/dashboard', (c) => c.html(DASHBOARD_HTML));

// API 路由（全部需要 admin key）
const api = new Hono<{ Bindings: AdminEnv }>();
api.use('*', requireAdmin);
api.route('/stats', statsRoute);
api.route('/users', usersRoute);
api.route('/cardkeys', cardkeysRoute);
api.route('/deepseek-usage', deepseekRoute);

app.route('/api', api);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
