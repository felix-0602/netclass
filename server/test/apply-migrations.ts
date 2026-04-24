// vitest setupFiles：每个测试开始前应用 D1 schema
// 测试只需要 schema（0001），不需要生产 seed（0002）——
// seed 文件含注释尾行会被 wrangler 的 SQL splitter 解析为空 statement，破坏 batch

import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  const schemaOnly = env.TEST_MIGRATIONS.filter(
    (m) => !m.name.includes('seed'),
  );
  await applyD1Migrations(env.DB, schemaOnly);
});
