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

  test('同源 iframe 内的 TiMu 也能被递归提取', async () => {
    // 构造：主页面是空的，iframe 内才是题目
    document.body.innerHTML = '<iframe id="work-iframe"></iframe>';
    const iframe = document.getElementById('work-iframe') as HTMLIFrameElement;

    // happy-dom 下 iframe.contentDocument 存在；等下个 tick 它 hydrate
    await new Promise((r) => setTimeout(r, 0));
    const innerDoc = iframe.contentDocument!;
    expect(innerDoc).toBeTruthy();

    // 把 fixture Q1 放进 iframe
    innerDoc.body.innerHTML = fixtures[0]!.outerHTML;

    const qs = extractQuestionsFromChaoxing(document);
    expect(qs).toHaveLength(1);
    expect(qs[0]!.platform_id).toBe('405405676');
  });

  test('W3v3: 选项含多个 img → 全部 placeholder 化，文本不被截断', () => {
    // 模拟实测高数 1.7+ 章节常见的 "方程通解是 [img1] 在区间 [img2] 内" 选项
    document.body.innerHTML = `
      <form>
        <div class="TiMu newTiMu">
          <input type="hidden" name="answer404966999" />
          <input type="hidden" name="answertype404966999" value="0" />
          <div class="Zy_TItle clearfix">
            <span>【单选题】求方程通解</span>
          </div>
          <div class="clearfix">
            <ul class="Zy_ulTop">
              <li>
                <label class="fl before">
                  <span class="num_option" data="A">A</span>
                </label>
                <div class="fl after">
                  方程通解是
                  <img class="ans-latex-moudle" src="https://p.ananas.chaoxing.com/star3/origin/aaa.png" data="%22y%3DC_1%20e%5Ex%22" />
                  在区间
                  <img class="ans-latex-moudle" src="https://p.ananas.chaoxing.com/star3/origin/bbb.png" data="%22(0%2C%5Cinfty)%22" />
                  内
                </div>
              </li>
              <li>
                <label class="fl before">
                  <span class="num_option" data="B">B</span>
                </label>
                <div class="fl after">纯文本选项</div>
              </li>
            </ul>
          </div>
        </div>
      </form>
    `;

    const qs = extractQuestionsFromChaoxing(document);
    expect(qs).toHaveLength(1);
    const q = qs[0]!;

    // 题干 0 张图，选项 A 有 2 张图 → images 应有 2 张
    expect(q.images.length).toBe(2);
    expect(q.tex_spans.length).toBe(2);
    expect(q.tex_spans[0]!.latex).toBe('y=C_1 e^x');
    expect(q.tex_spans[1]!.latex).toBe('(0,\\infty)');

    // 选项 A 的 text 应嵌入两个 placeholder（不被截成 "方程通解是" 前缀）
    expect(q.options).toHaveLength(2);
    const optA = q.options.find((o) => o.label === 'A')!;
    expect(optA.text).toContain('方程通解是');
    expect(optA.text).toContain('在区间');
    expect(optA.text).toContain('内');
    expect(optA.text).toContain('<<M1>>');
    expect(optA.text).toContain('<<M2>>');
    // 多图情况下 image_ref 留 null，由 text 表达
    expect(optA.image_ref).toBeNull();

    const optB = q.options.find((o) => o.label === 'B')!;
    expect(optB.text).toBe('纯文本选项');
    expect(optB.image_ref).toBeNull();
  });

  test('W3v3: 选项单图保持 image_ref 兼容性（不破坏 v1/v2 行为）', () => {
    document.body.innerHTML = `
      <form>
        <div class="TiMu newTiMu">
          <input type="hidden" name="answer404967000" />
          <input type="hidden" name="answertype404967000" value="0" />
          <div class="Zy_TItle clearfix">
            <span>【单选题】下列正确的是</span>
          </div>
          <div class="clearfix">
            <ul class="Zy_ulTop">
              <li>
                <label class="fl before">
                  <span class="num_option" data="A">A</span>
                </label>
                <div class="fl after">
                  <img class="ans-latex-moudle" src="https://p.ananas.chaoxing.com/star3/origin/single.png" data="%22y%3D2x%22" />
                </div>
              </li>
            </ul>
          </div>
        </div>
      </form>
    `;

    const qs = extractQuestionsFromChaoxing(document);
    const q = qs[0]!;
    const optA = q.options[0]!;
    // 单图：image_ref 仍是 placeholder（向后兼容）
    expect(optA.image_ref).toBe('<<M1>>');
    expect(q.tex_spans[0]!.latex).toBe('y=2x');
  });

  test('跨域 iframe 访问 contentDocument 失败时不抛', () => {
    // 模拟跨域 iframe：把 contentDocument getter 改成 throw
    document.body.innerHTML = '<iframe id="xo"></iframe>';
    const iframe = document.getElementById('xo') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    });

    // 也在主 document 放一条 TiMu，确认跨域失败不影响主 doc
    const wrapper = document.createElement('div');
    wrapper.innerHTML = fixtures[1]!.outerHTML;
    document.body.appendChild(wrapper);

    expect(() => extractQuestionsFromChaoxing(document)).not.toThrow();
    const qs = extractQuestionsFromChaoxing(document);
    expect(qs.length).toBeGreaterThanOrEqual(1);
  });
});
