// vitest-pool-workers 的类型增强
// 让 cloudflare:test 里的 env 拥有本项目的 Bindings + 测试用的 TEST_MIGRATIONS

import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Env } from '../src/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
