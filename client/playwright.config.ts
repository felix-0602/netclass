import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// E2E 跑在 test/e2e/ 下，跟 vitest（test/*.spec.ts）的单元测试分开。
// 加载 file:// 下的 fixtures，不依赖外网。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: resolve(__dirname, 'test/e2e'),
  timeout: 15_000,
  // Windows 上并行启 chromium 会 spawn EBUSY（user-data-dir 互锁）
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
