import { describe, expect, test, vi } from 'vitest';
import { fillChoice } from '../src/answer/fill/choice';
import { fillBlank } from '../src/answer/fill/blank';
import { fillJudge } from '../src/answer/fill/judge';
import { fillEssay } from '../src/answer/fill/essay';
import type { FillContext } from '../src/answer/fill/types';

function makeContext(html: string): FillContext {
  document.body.innerHTML = `<div class="TiMu" data-test-root>${html}</div>`;
  const timu = document.querySelector('.TiMu') as HTMLElement;
  return { timu, doc: document };
}

describe('fillChoice — 单选/多选', () => {
  test('精确命中选项 → 点击', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option">A</span><span class="after">是</span></li>
        <li><span class="num_option">B</span><span class="after">否</span></li>
      </ul>
    `);
    const liA = ctx.timu.querySelectorAll('li')[0]!;
    const clickSpy = vi.fn();
    liA.addEventListener('click', clickSpy);

    const res = fillChoice(ctx, ['是']);
    expect(res.status).toBe('filled');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('W3v4 核心 bug 修：raw answer 是字母 "B" → 通过 num_option data-label 直接定位', () => {
    // 模拟 server 返 {value:"B", raw:["B"]} 的命中场景
    // 选项是公式图（无文字），旧版 fillChoice 用 text 匹配会 0 命中
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option" data="A">A</span><a class="fl after"><img src="..." data="%22y%3D2x%22"/></a></li>
        <li><span class="num_option" data="B">B</span><a class="fl after"><img src="..." data="%22y%3Dx%5E2%2BC%22"/></a></li>
        <li><span class="num_option" data="C">C</span><a class="fl after"><img src="..." data="%22y%3D2x%2B1%22"/></a></li>
      </ul>
    `);
    const [a, b, c] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clicks = new Set<string>();
    a.addEventListener('click', () => clicks.add('A'));
    b.addEventListener('click', () => clicks.add('B'));
    c.addEventListener('click', () => clicks.add('C'));

    const res = fillChoice(ctx, ['B']);
    expect(res.status).toBe('filled');
    expect(clicks.has('B')).toBe(true);
    expect(clicks.has('A')).toBe(false);
    expect(clicks.has('C')).toBe(false);
  });

  test('W3v4: chaoxing shuffle (data ≠ display) → 按 data 字母选，不按 display A/B/C', () => {
    // chaoxing 偶尔重排显示顺序但 data 字段保留真实字母
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option" data="C">A</span>显示A实际C</li>
        <li><span class="num_option" data="A">B</span>显示B实际A</li>
        <li><span class="num_option" data="B">C</span>显示C实际B</li>
      </ul>
    `);
    const [li0, li1, li2] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clicks = new Set<string>();
    li0.addEventListener('click', () => clicks.add('li0'));
    li1.addEventListener('click', () => clicks.add('li1'));
    li2.addEventListener('click', () => clicks.add('li2'));

    // server 返 "B" → 应点 li2 (data="B")
    const res = fillChoice(ctx, ['B']);
    expect(res.status).toBe('filled');
    expect(clicks.has('li2')).toBe(true);
  });

  test('多选全答上 → filled', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option">A</span><span class="after">苹果</span></li>
        <li><span class="num_option">B</span><span class="after">香蕉</span></li>
        <li><span class="num_option">C</span><span class="after">西瓜</span></li>
      </ul>
    `);
    const [a, b, c] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clicks = new Set<string>();
    a.addEventListener('click', () => clicks.add('A'));
    b.addEventListener('click', () => clicks.add('B'));
    c.addEventListener('click', () => clicks.add('C'));

    const res = fillChoice(ctx, ['苹果', '西瓜']);
    expect(res.status).toBe('filled');
    expect(clicks.has('A')).toBe(true);
    expect(clicks.has('C')).toBe(true);
    expect(clicks.has('B')).toBe(false);
  });

  test('已选中不再 click', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li aria-checked="true"><span class="num_option">A</span><span class="after">是</span></li>
        <li><span class="num_option">B</span><span class="after">否</span></li>
      </ul>
    `);
    const liA = ctx.timu.querySelectorAll('li')[0]!;
    const clickSpy = vi.fn();
    liA.addEventListener('click', clickSpy);

    const res = fillChoice(ctx, ['是']);
    expect(res.status).toBe('filled');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  test('相似度兜底 —— 精确失败走 Levenshtein', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option">A</span><span class="after">f(x) = 2x + 1</span></li>
        <li><span class="num_option">B</span><span class="after">f(x) = x - 1</span></li>
      </ul>
    `);
    const [a] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clickSpy = vi.fn();
    a.addEventListener('click', clickSpy);

    // 精确文本带多余空格，相似度兜底
    const res = fillChoice(ctx, ['f(x)  =  2x  +  1']);
    expect(res.status).toBe('filled');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('所有答案都不匹配 → error', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option">A</span><span class="after">苹果</span></li>
      </ul>
    `);
    const res = fillChoice(ctx, ['火星']);
    expect(res.status).toBe('error');
    expect(res.matched).toBe(0);
  });

  test('部分匹配 → partial', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span class="num_option">A</span><span class="after">X</span></li>
      </ul>
    `);
    const res = fillChoice(ctx, ['X', 'Y']);
    expect(res.status).toBe('partial');
    expect(res.matched).toBe(1);
    expect(res.total).toBe(2);
  });

  test('无选项结构 → unsupported', () => {
    const ctx = makeContext(`<div>没有选项列表</div>`);
    const res = fillChoice(ctx, ['X']);
    expect(res.status).toBe('unsupported');
  });
});

describe('fillJudge — 判断', () => {
  test('对 → 点击 "对选择" li', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li aria-label="对选择"><span class="num_option">A</span>对</li>
        <li aria-label="错选择"><span class="num_option">B</span>错</li>
      </ul>
    `);
    const [liTrue] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clickSpy = vi.fn();
    liTrue.addEventListener('click', clickSpy);

    expect(fillJudge(ctx, ['正确']).status).toBe('filled');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('错 → 点击 "错选择" li', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li aria-label="对选择"><span class="num_option">A</span>对</li>
        <li aria-label="错选择"><span class="num_option">B</span>错</li>
      </ul>
    `);
    const [, liFalse] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const clickSpy = vi.fn();
    liFalse.addEventListener('click', clickSpy);

    expect(fillJudge(ctx, ['错误']).status).toBe('filled');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('多语种 true 关键字都认', () => {
    for (const answer of ['true', 'True', 'T', 'yes', '1', '√', '对', '是', '正确']) {
      const ctx = makeContext(`
        <ul class="Zy_ulTop">
          <li aria-label="对选择">对</li>
          <li aria-label="错选择">错</li>
        </ul>
      `);
      expect(fillJudge(ctx, [answer]).status).toBe('filled');
    }
  });

  test('无法解析的答案 → error', () => {
    const ctx = makeContext(`<ul class="Zy_ulTop"><li aria-label="对选择">对</li><li aria-label="错选择">错</li></ul>`);
    const res = fillJudge(ctx, ['洗麦']);
    expect(res.status).toBe('error');
  });

  test('span[data] 策略（ks 考试版）', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li><span data="true">对</span></li>
        <li><span data="false">错</span></li>
      </ul>
    `);
    const [li1, li2] = Array.from(ctx.timu.querySelectorAll('li')) as HTMLElement[];
    const sp1 = vi.fn();
    const sp2 = vi.fn();
    li1.addEventListener('click', sp1);
    li2.addEventListener('click', sp2);

    fillJudge(ctx, ['对']);
    expect(sp1).toHaveBeenCalled();
    expect(sp2).not.toHaveBeenCalled();
  });

  test('已选中 → skipped', () => {
    const ctx = makeContext(`
      <ul class="Zy_ulTop">
        <li aria-checked="true" aria-label="对选择">对</li>
        <li aria-label="错选择">错</li>
      </ul>
    `);
    const res = fillJudge(ctx, ['对']);
    expect(res.status).toBe('skipped');
  });
});

describe('fillBlank — 填空', () => {
  test('多空逐项填入 textarea（无 UEditor fallback）', () => {
    const ctx = makeContext(`
      <textarea name="q1"></textarea>
      <textarea name="q2"></textarea>
    `);
    const res = fillBlank(ctx, ['答案一', '答案二']);
    expect(res.status).toBe('filled');
    const [t1, t2] = Array.from(ctx.timu.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    expect(t1.value).toBe('答案一');
    expect(t2.value).toBe('答案二');
  });

  test('有 UEditor 时优先用 setContent', () => {
    const ctx = makeContext(`<textarea name="q1"></textarea>`);
    const setContent = vi.fn();
    (ctx.doc.defaultView as unknown as { UE: unknown }).UE = {
      getEditor: () => ({ setContent }),
    };

    const res = fillBlank(ctx, ['<p>富文本</p>']);
    expect(res.status).toBe('filled');
    // removeHtml 把标签剥掉
    expect(setContent).toHaveBeenCalledWith('富文本');

    delete (ctx.doc.defaultView as unknown as { UE?: unknown }).UE;
  });

  test('答案数 < textarea 数 → partial', () => {
    const ctx = makeContext(`
      <textarea name="q1"></textarea>
      <textarea name="q2"></textarea>
    `);
    const res = fillBlank(ctx, ['一']);
    expect(res.status).toBe('filled'); // total=min(2,1)=1, matched=1
    expect(res.matched).toBe(1);
    expect(res.total).toBe(1);
  });

  test('无 textarea → unsupported', () => {
    const ctx = makeContext(`<div>无空</div>`);
    expect(fillBlank(ctx, ['x']).status).toBe('unsupported');
  });
});

describe('fillEssay — 简答', () => {
  test('单 textarea 塞 answer[0]', () => {
    const ctx = makeContext(`<textarea name="essay1"></textarea>`);
    const res = fillEssay(ctx, ['这是一段简答']);
    expect(res.status).toBe('filled');
    expect((ctx.timu.querySelector('textarea') as HTMLTextAreaElement).value).toBe('这是一段简答');
  });

  test('UEditor 存在时走 setContent', () => {
    const ctx = makeContext(`<textarea name="essay1"></textarea>`);
    const setContent = vi.fn();
    (ctx.doc.defaultView as unknown as { UE: unknown }).UE = {
      getEditor: () => ({ setContent }),
    };

    expect(fillEssay(ctx, ['简答内容']).status).toBe('filled');
    expect(setContent).toHaveBeenCalledWith('简答内容');

    delete (ctx.doc.defaultView as unknown as { UE?: unknown }).UE;
  });

  test('空答案 → error', () => {
    const ctx = makeContext(`<textarea name="essay1"></textarea>`);
    expect(fillEssay(ctx, ['']).status).toBe('error');
  });

  test('无 textarea → unsupported', () => {
    const ctx = makeContext(`<div>非简答区</div>`);
    expect(fillEssay(ctx, ['x']).status).toBe('unsupported');
  });
});
