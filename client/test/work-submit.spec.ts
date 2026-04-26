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

  test('W3v6 实测：popup 在 top doc + 提交按钮 onclick 为空（jQuery 绑事件）→ 仍命中', async () => {
    document.body.innerHTML = `
      <a class="btnSubmit workBtnIndex">提交</a>
      <div class="maskDiv" style="display:none"></div>
      <div class="popDiv wid440 Marking" style="display:none">
        <a class="popClose fr"></a>
        <a class="jb_btn jb_btn_92 fr fs14">提交</a>
        <a class="btnBlue btn_92_cancel fr fs14">取消</a>
      </div>
    `;
    const main = document.querySelector<HTMLAnchorElement>('a.btnSubmit')!;
    const confirmBtn = document.querySelector<HTMLAnchorElement>('.popDiv.wid440.Marking a.jb_btn.jb_btn_92:not(.btn_92_cancel)')!;
    const cancelBtn = document.querySelector<HTMLAnchorElement>('.btn_92_cancel')!;
    const closeBtn = document.querySelector<HTMLAnchorElement>('.popClose')!;
    const confirmSpy = vi.spyOn(confirmBtn, 'click');
    const cancelSpy = vi.spyOn(cancelBtn, 'click');
    const closeSpy = vi.spyOn(closeBtn, 'click');

    main.addEventListener('click', () => {
      document.querySelector<HTMLElement>('.maskDiv')!.style.display = '';
      document.querySelector<HTMLElement>('.popDiv.wid440.Marking')!.style.display = '';
    });

    const r = await submitWork(document, { confirmDelayMs: 50 });
    expect(r.status).toBe('submitted');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // 取消和关闭按钮**必须不被点**
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  test('W3v6: 提交后弹"未到及格线请重做" → status=submitted + redoPrompt 报告', async () => {
    document.body.innerHTML = `
      <a class="btnSubmit">提交</a>
      <div class="popDiv wid440 Marking" style="display:none">
        <a class="jb_btn jb_btn_92 fr fs14">提交</a>
      </div>
      <div class="popDiv" style="display:none" id="redo-prompt">
        分数过低，未到及格线请重做
      </div>
    `;
    const main = document.querySelector<HTMLAnchorElement>('a.btnSubmit')!;
    main.addEventListener('click', () => {
      document.querySelector<HTMLElement>('.popDiv.wid440.Marking')!.style.display = '';
    });
    // 模拟 confirm 点完后弹"未及格"提示
    const confirmBtn = document.querySelector<HTMLAnchorElement>('.popDiv.wid440.Marking a.jb_btn.jb_btn_92')!;
    confirmBtn.addEventListener('click', () => {
      document.querySelector<HTMLElement>('#redo-prompt')!.style.display = '';
    });

    const r = await submitWork(document, { confirmDelayMs: 50 });
    expect(r.status).toBe('submitted');
    if (r.status === 'submitted') {
      expect(r.redoPrompt).toContain('未到及格线');
    }
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

  test('W3v6 实测：CorrectOrNot 容器内 .marking_dui → correct', () => {
    document.body.innerHTML = `
      <div class="TiMu newTiMu ans-cc singleQuesId">
        <input type="hidden" name="answer404966163" />
        <div class="CorrectOrNot fl"><span class="marking_dui"></span></div>
      </div>
    `;
    const marks = readMarks(document);
    expect(marks[0]!.correct).toBe('correct');
    expect(marks[0]!.evidence).toContain('marking_dui');
  });

  test('W3v6 实测：CorrectOrNot 容器内 .marking_cuo → wrong', () => {
    document.body.innerHTML = `
      <div class="TiMu newTiMu ans-cc singleQuesId">
        <input type="hidden" name="answer404966164" />
        <div class="CorrectOrNot fl"><span class="marking_cuo"></span></div>
      </div>
    `;
    const marks = readMarks(document);
    expect(marks[0]!.correct).toBe('wrong');
    expect(marks[0]!.evidence).toContain('marking_cuo');
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
