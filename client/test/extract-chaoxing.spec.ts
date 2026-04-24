import { describe, expect, test, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractQuestionsFromChaoxing } from '../src/adapters/chaoxing';

/**
 * 用真实 DOM fixture 验证 TiMu 提取器。
 *
 * fixture 来源：docs/recon/fixtures/chaoxing-math-gaoshu-ch7.1.json
 * 是 2026-04-24 实地从超星高数微分方程章节测验抓到的 6 道单选。
 * 每条 JSON 包含题目的完整 outerHTML，字体混淆痕迹 + 图片 URL 齐全。
 *
 * 注意：fixture 里的 font-cxsecret 样式标签并未附带真实 ttf 字体数据，
 * 所以 decryptDocument 在测试里会 no-op（返回空 match）。题干文本看起来是乱码
 * 但**提取器本身**照常运行；decode 的单元测试覆盖在 decode-cxsecret.spec.ts。
 */

interface TiMuFixture {
  index: number;
  outerHTML: string;
  imgCount: number;
  inputNames: string[];
}

const fixturePath = resolve(
  __dirname,
  '../../docs/recon/fixtures/chaoxing-math-gaoshu-ch7.1.json',
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as TiMuFixture[];

describe('extractQuestionsFromChaoxing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('fixture: 6 道高数题全部能被识别', () => {
    // 把 6 条 outerHTML 拼进一个 <form>，模拟真实页面
    const form = document.createElement('form');
    fixtures.forEach((f) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = f.outerHTML;
      form.appendChild(wrapper);
    });
    document.body.appendChild(form);

    const qs = extractQuestionsFromChaoxing(document);
    expect(qs.length).toBe(6);
  });

  test('Q1: platform_id / type / 选项数 正确', () => {
    document.body.innerHTML = fixtures[0]!.outerHTML;
    const qs = extractQuestionsFromChaoxing(document);
    expect(qs).toHaveLength(1);

    const q = qs[0]!;
    expect(q.platform).toBe('chaoxing');
    expect(q.type).toBe('single'); // fixture 里是单选题
    expect(q.platform_id).toMatch(/^\d+$/); // 超星 questionId 是数字串
    expect(q.platform_id).toBe('405405676'); // 从 inputNames 预期

    // 4 个选项
    expect(q.options.length).toBe(4);
    expect(q.options.map((o) => o.label).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  test('Q1: LaTeX 源从 img data 属性解码', () => {
    document.body.innerHTML = fixtures[0]!.outerHTML;
    const qs = extractQuestionsFromChaoxing(document);
    const q = qs[0]!;

    // 题干包含占位符
    expect(q.text).toMatch(/<<M\d+>>/);

    // tex_spans 至少含 y' = 2x 和 y = x^2 + C
    const latexes = q.tex_spans.map((t) => t.latex).filter(Boolean);
    expect(latexes.some((l) => l?.includes("y' = 2x") || l?.includes('y\'=2x'))).toBe(true);
    expect(latexes.some((l) => l?.includes('x^2 + C'))).toBe(true);
  });

  test('Q1: 图片 URL 都是 p.ananas.chaoxing.com 域', () => {
    document.body.innerHTML = fixtures[0]!.outerHTML;
    const qs = extractQuestionsFromChaoxing(document);
    const q = qs[0]!;

    expect(q.images.length).toBeGreaterThan(0);
    q.images.forEach((url) => {
      expect(url).toMatch(/^https?:\/\/p\.ananas\.chaoxing\.com/);
    });
  });

  test('Q1: answer_target.answer_input_name 可用于答题回填', () => {
    document.body.innerHTML = fixtures[0]!.outerHTML;
    const qs = extractQuestionsFromChaoxing(document);
    const q = qs[0]!;

    expect(q.answer_target.answer_input_name).toBe('answer405405676');
    expect(q.answer_target.answer_type_input_name).toBe('answertype405405676');
  });

  test('空页面不抛异常', () => {
    document.body.innerHTML = '<div>hello</div>';
    expect(extractQuestionsFromChaoxing(document)).toEqual([]);
  });
});
