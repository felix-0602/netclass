import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readMarks, submitWork } from '../src/runtime/work-submit';

describe('submitWork', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('找到 .btnSubmit 点击 → 检测确认按钮再点 → submitted', async () => {
    document.body.innerHTML = `
      <a class="btnSubmit workBtnIndex" onclick="btnBlueSubmit();">提交</a>
      <div class="popDiv" style="display:none">
        <a class="btnBlue" onclick="submitCheckTimes();">确定</a>
      </div>
    `;
    const main = document.querySelector<HTMLAnchorElement>('a.btnSubmit')!;
    const confirm = document.querySelector<HTMLAnchorElement>('a.btnBlue')!;
    const mainSpy = vi.spyOn(main, 'click');
    const confirmSpy = vi.spyOn(confirm, 'click');

    // 点了 main 后 popup 才会变可见
    main.addEventListener('click', () => {
      const pop = document.querySelector<HTMLElement>('.popDiv');
      if (pop) pop.style.display = '';
    });

    const r = await submitWork(document, { confirmDelayMs: 50 });
    expect(r.status).toBe('submitted');
    expect(mainSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  test('没提交按钮 → no-button', async () => {
    document.body.innerHTML = '<div>nothing</div>';
    const r = await submitWork(document, { confirmDelayMs: 10 });
    expect(r.status).toBe('no-button');
  });

  test('提交按钮存在但隐藏 → no-button', async () => {
    document.body.innerHTML = '<a class="btnSubmit" style="display:none">提交</a>';
    const r = await submitWork(document, { confirmDelayMs: 10 });
    expect(r.status).toBe('no-button');
  });
});

describe('readMarks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('TiMu 含 .zybcorrect → correct', () => {
    document.body.innerHTML = `
      <div class="TiMu">
        <input type="hidden" name="answer123" />
        <span class="zybcorrect">✓</span>
      </div>
    `;
    const marks = readMarks(document);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.correct).toBe('correct');
    expect(marks[0]!.evidence).toContain('zybcorrect');
    expect(marks[0]!.inputName).toBe('answer123');
  });

  test('TiMu 含 .zybwrong → wrong', () => {
    document.body.innerHTML = `
      <div class="TiMu">
        <input type="hidden" name="answer456" />
        <span class="zybwrong">✗</span>
      </div>
    `;
    const marks = readMarks(document);
    expect(marks[0]!.correct).toBe('wrong');
  });

  test('TiMu 没 marker → unknown', () => {
    document.body.innerHTML = `
      <div class="TiMu">
        <input type="hidden" name="answer789" />
        <p>题目内容</p>
      </div>
    `;
    const marks = readMarks(document);
    expect(marks[0]!.correct).toBe('unknown');
  });

  test('多 TiMu 混合对错', () => {
    document.body.innerHTML = `
      <div class="TiMu"><input name="answer1" /><span class="zybcorrect">✓</span></div>
      <div class="TiMu"><input name="answer2" /><span class="zybwrong">✗</span></div>
      <div class="TiMu"><input name="answer3" /></div>
    `;
    const marks = readMarks(document);
    expect(marks.map((m) => m.correct)).toEqual(['correct', 'wrong', 'unknown']);
  });

  test('TiMu class 含 cuoti → wrong (兜底)', () => {
    document.body.innerHTML = `
      <div class="TiMu cuoti"><input name="answer_x" /></div>
    `;
    const marks = readMarks(document);
    expect(marks[0]!.correct).toBe('wrong');
    expect(marks[0]!.evidence).toContain('timu-class');
  });
});
