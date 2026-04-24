import { defineConfig } from 'vitest/config';

// 从 Cloudflare Workers Pool 迁回纯 Node vitest 后的配置
// better-sqlite3 + @hono/node-server 都是 Node 原生，无需特殊 pool

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
});
