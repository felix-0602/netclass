import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// E2E 回归：防止"5 浮窗"复发。
//
// 背景：超星页面 1-4 层同源 iframe，userscript 在每层都会被执行一次。
// 早期版本在每层都挂了 Panel → 用户同时看到 5 个浮窗。
// 现在的约定（见 mount.ts / main.ts）：
//   1. 只有顶层 frame 挂 UI
//   2. 同 frame 内重复注入时只挂一次
//
// 这里用 Playwright 真实嵌套 iframe（4 层自递归）跑 fixture，
// 验证整个 frame 树里最多只出现 1 个 #netclass-sidekick-host。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureUrl = pathToFileURL(
  resolve(__dirname, 'fixtures/nested-iframe.html'),
).href;

test.describe('嵌套 iframe 中的 Panel 挂载去重', () => {
  test('4 层自递归 iframe 中只有顶层挂了 1 个 host', async ({ page }) => {
    await page.goto(fixtureUrl);

    // 等所有子 iframe 递归加载完 —— 3 层嵌套 + 顶层 = 4 frame
    await expect.poll(() => page.frames().length, { timeout: 5000 }).toBe(4);

    // 遍历所有 frame，统计 #netclass-sidekick-host
    const frames = page.frames();
    const counts = await Promise.all(
      frames.map(async (frame) => {
        const count = await frame.evaluate(
          () => document.querySelectorAll('#netclass-sidekick-host').length,
        );
        const url = frame.url();
        const isTop = await frame.evaluate(() => window.self === window.top);
        return { url: url.split('/').pop(), isTop, count };
      }),
    );

    const totalHosts = counts.reduce((sum, c) => sum + c.count, 0);
    expect(totalHosts, `整个 frame 树只应有 1 个 host，实际：${JSON.stringify(counts)}`).toBe(1);

    // 这个 1 必须在 top frame 里
    const topFrameCount = counts.find((c) => c.isTop);
    expect(topFrameCount?.count).toBe(1);

    // 所有非 top frame 都应该是 0
    const childFrameCounts = counts.filter((c) => !c.isTop);
    expect(childFrameCounts.length).toBe(3);
    childFrameCounts.forEach((c) => {
      expect(c.count, `child frame ${c.url} 不应挂 host`).toBe(0);
    });
  });

  test('同 frame 内重复调用 maybeMountPanel 只挂一次', async ({ page }) => {
    await page.goto(fixtureUrl);

    // fixture 里故意调了两次 maybeMountPanel，结果存到 window.__netclassMountResults
    const results = await page.evaluate(
      () => (window as unknown as { __netclassMountResults: string[] }).__netclassMountResults,
    );

    // 第一次应 mounted，第二次应 skip-already-mounted
    expect(results).toEqual(['mounted', 'skip-already-mounted']);
  });

  test('子 frame 的 maybeMountPanel 返回 skip-not-top', async ({ page }) => {
    await page.goto(fixtureUrl);
    await expect.poll(() => page.frames().length, { timeout: 5000 }).toBe(4);

    const childFrames = page.frames().filter((f) => f !== page.mainFrame());
    expect(childFrames.length).toBe(3);

    for (const frame of childFrames) {
      const results = await frame.evaluate(
        () =>
          (window as unknown as { __netclassMountResults: string[] })
            .__netclassMountResults,
      );
      expect(results).toEqual(['skip-not-top', 'skip-not-top']);
    }
  });
});
