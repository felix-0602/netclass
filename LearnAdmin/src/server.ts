import { serve } from '@hono/node-server';
import app from './index';
import { createEnv } from './env';

const env = createEnv();

serve(
  { fetch: (req: Request) => app.fetch(req, env), port: Number(process.env.PORT ?? 3000), hostname: '0.0.0.0' },
  (info) => {
    console.info(`[learn-admin] http://0.0.0.0:${info.port}/`);
    console.info(`[learn-admin] DB: ${env.DB_PATH}`);
  },
);
