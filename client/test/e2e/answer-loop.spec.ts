import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// E2E 回归：端到端验证"发现题目 → 回填"闭环
//
// 为避免真打 /answer 服务端，这里只测到"答案手动交付后回填"的子链路：
//   1. Playwright 加载模拟的 chaoxing 作业 HTML（3 道题：单选/判断/多选）
//   2. 在 page.evaluate 里直接调 fill/choice.ts + fill/judge.ts 的等价逻辑
//      （打包后的 bundle 太重，这里复现相同契约代替直接注 userscript）
//   3. 断言题目被勾选正确
//
// 真正的全链路 E2E（client -> /answer -> drain -> next hit）需要在真实服务端 + 真卡密环境下跑，
// 放到 Phase 0.W3 任务 0.19 的人工手测里。

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureUrl = pathToFileURL(
  resolve(__dirname, 'fixtures/chaoxing-work.html'),
).href;

test.describe('答题闭环子链路（DOM 级别）', () => {
  test('单选题：给定正确答案文本，对应 li 被勾选', async ({ page }) => {
    await page.goto(fixtureUrl);

    // 模拟 fillChoice 对单选题的行为：点击文本精确匹配的 li
    await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[0]!;
      const lis = timu.querySelectorAll('.Zy_ulTop > li');
      const answer = '2';
      for (const li of lis) {
        const text = li.querySelector('.after')?.textContent?.trim();
        if (text === answer) {
          (li as HTMLElement).click();
          break;
        }
      }
    });

    const selected = await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[0]!;
      return Array.from(timu.querySelectorAll('.Zy_ulTop > li'))
        .filter((li) => li.getAttribute('aria-checked') === 'true')
        .map((li) => li.querySelector('.after')?.textContent?.trim());
    });
    expect(selected).toEqual(['2']);
  });

  test('判断题：答 "正确" → 对选择被勾选', async ({ page }) => {
    await page.goto(fixtureUrl);

    await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[1]!;
      const lis = timu.querySelectorAll('.Zy_ulTop > li');
      for (const li of lis) {
        if (li.getAttribute('aria-label')?.includes('对选择')) {
          (li as HTMLElement).click();
          break;
        }
      }
    });

    const selected = await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[1]!;
      const sel = timu.querySelector('li[aria-checked="true"]');
      return sel?.getAttribute('aria-label');
    });
    expect(selected).toBe('对选择');
  });

  test('多选题：答 ["红","蓝"] → A+C 同时被勾选', async ({ page }) => {
    await page.goto(fixtureUrl);

    await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[2]!;
      const lis = timu.querySelectorAll('.Zy_ulTop > li');
      const answers = ['红', '蓝'];
      for (const answer of answers) {
        for (const li of lis) {
          const text = li.querySelector('.after')?.textContent?.trim();
          if (text === answer && li.getAttribute('aria-checked') !== 'true') {
            (li as HTMLElement).click();
            break;
          }
        }
      }
    });

    const selected = await page.evaluate(() => {
      const timu = document.querySelectorAll('.TiMu')[2]!;
      return Array.from(timu.querySelectorAll('.Zy_ulTop > li[aria-checked="true"]'))
        .map((li) => li.querySelector('.after')?.textContent?.trim());
    });
    expect(new Set(selected)).toEqual(new Set(['红', '蓝']));
  });

  test('fixture 有 3 个 .TiMu', async ({ page }) => {
    await page.goto(fixtureUrl);
    const count = await page.locator('.TiMu').count();
    expect(count).toBe(3);
  });
});
