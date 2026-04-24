// Node 运行时入口。npm run dev / npm start 都跑这个。
// - 装 Hono 到 @hono/node-server
// - 构造 env + executionCtx shim，作为 app.fetch 的第 2、3 参注入
// - 启动时 apply migrations（若 DB 尚未建表）
// - 裸 IP HTTP 8080 监听，外部通过 http://<IP>:8080/... 直连

import { serve } from '@hono/node-server';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import app from './index.js';
import { createEnv } from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const env = createEnv();

// 启动时自动应用 migrations（幂等：schema 已存在时跳过）
applyMigrationsOnBoot(process.env.DB_PATH ?? './netclass.db');

// Workers ExecutionContext 的最小 shim
const executionCtx = {
  waitUntil(p: Promise<unknown>): void {
    void p.catch((err: unknown) => console.error('[waitUntil]', err));
  },
  passThroughOnException(): void {
    /* no-op */
  },
};

const handler = {
  fetch: (req: Request) => app.fetch(req, env, executionCtx as never),
};

serve(
  {
    fetch: handler.fetch,
    port: env.PORT,
    hostname: '0.0.0.0', // 对外可达（Tampermonkey @connect 需要）
  },
  (info) => {
    console.info(
      `[netclass-server] listening on http://${info.address === '::' ? '0.0.0.0' : info.address}:${info.port}`,
    );
    console.info(`[netclass-server] protocol ${env.PROTOCOL_VERSION}`);
    console.info('[netclass-server] 外部访问：http://<机器 IP>:' + info.port + '/healthz');
  },
);

// ----------------------------------------------------------
// helpers

function applyMigrationsOnBoot(dbPath: string): void {
  // 只在启动时跑一次；幂等（IF NOT EXISTS）
  const migrationsDir = join(__dirname, 'db', 'migrations');
  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.includes('seed'))
      .sort();
  } catch {
    console.warn('[migrations] 目录不存在，跳过启动迁移');
    return;
  }
  if (files.length === 0) return;

  const db = new Database(dbPath);
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    try {
      db.exec(sql);
      console.info(`[migrations] 应用 ${f}`);
    } catch (e) {
      console.warn(`[migrations] ${f} 已存在或跳过: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  db.close();
}

// 防止 Workers 运行时类型声明污染
// （TS 在 Node 下没 ExecutionContext 全局）
type ExecutionContext = unknown;
