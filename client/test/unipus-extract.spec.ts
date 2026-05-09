// U 校园题目提取 + 填入测试
// 基于 2026-05-09 browser 实测 DOM 结构

import { describe, expect, test, beforeEach } from 'vitest';
import { extractQuestionsFromUnipus, fillUnipusAnswer } from '../src/adapters/unipus';

const FILL_BLANK_HTML = `
<div class="question-common-abs-question-container">
  <div class="abs-direction"><span class="title">Directions:</span>
    <div class="content">Listen and fill in the blanks.</div>
  </div>
  <div class="question-common-abs-reply">
    <div class="question-common-abs-scoop comp-scoop-reply fill-blank-reply">
      <div class="item">
        <div class="component-htmlview"><p>China's efforts to narrow the technology gap</p>
          <table><tr><td>
            <span class="question-number">1</span>
            <div class="comp-abs-input input-user-answer"><input value="" type="text"></div>
          </td></tr><tr><td>
            <span class="question-number">2</span>
            <div class="comp-abs-input input-user-answer"><input value="" type="text"></div>
          </td></tr><tr><td>
            <span class="question-number">3</span>
            <div class="comp-abs-input input-user-answer"><input value="" type="text"></div>
          </td></tr></table>
        </div>
      </div>
    </div>
  </div>
  <audio class="unipus-audio-h5" src="https://ucontent.cdn.unipus.cn/test.mp3#duration=120"></audio>
</div>`;

const CHOICE_HTML = `
<div class="question-common-abs-question-container">
  <div class="abs-direction"><span class="title">Directions:</span>
    <div class="content">Choose the best answer.</div>
  </div>
  <div class="question-common-abs-reply">
    <div class="question-common-abs-choice">
      <div class="component-htmlview ques-title"><p>1.&nbsp;</p></div>
      <div class="option-wrap">
        <div class="option"><div class="caption">A</div><div class="content"><p>Language classes.</p></div></div>
        <div class="option"><div class="caption">B</div><div class="content"><p>Scientific research.</p></div></div>
        <div class="option"><div class="caption">C</div><div class="content"><p>International exchanges.</p></div></div>
        <div class="option"><div class="caption">D</div><div class="content"><p>Cultural inheritance.</p></div></div>
      </div>
    </div>
    <div class="question-common-abs-choice">
      <div class="component-htmlview ques-title"><p>2.&nbsp;</p></div>
      <div class="option-wrap">
        <div class="option"><div class="caption">A</div><div class="content"><p>8,000.</p></div></div>
        <div class="option"><div class="caption">B</div><div class="content"><p>80,000.</p></div></div>
        <div class="option"><div class="caption">C</div><div class="content"><p>300 million.</p></div></div>
        <div class="option"><div class="caption">D</div><div class="content"><p>600 million.</p></div></div>
      </div>
    </div>
  </div>
  <audio class="unipus-audio-h5" src="https://ucontent.cdn.unipus.cn/test.mp3"></audio>
</div>`;

describe('extractQuestionsFromUnipus — 填空', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('3 个 input → 3 道填空题', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs.length).toBe(3);
    for (const q of qs) {
      expect(q.platform).toBe('unipus');
      expect(q.type).toBe('fill');
    }
  });

  test('音频 URL 写入 images', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs.filter((q) => q.images.length > 0).length).toBe(3);
  });

  test('题干含 Directions', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs[0]!.text).toContain('Listen');
  });
});

describe('extractQuestionsFromUnipus — 选择', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('2 个 .question-common-abs-choice → 2 道选择题', () => {
    document.body.innerHTML = CHOICE_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs.length).toBe(2);
    for (const q of qs) {
      expect(q.platform).toBe('unipus');
      expect(q.type).toBe('single');
      expect(q.options.length).toBe(4);
    }
  });

  test('选项 caption 正确', () => {
    document.body.innerHTML = CHOICE_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs[0]!.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(qs[0]!.options[0]!.text).toBe('Language classes.');
  });

  test('answer_input_name 含 choice 模式 + captions', () => {
    document.body.innerHTML = CHOICE_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs[0]!.answer_target.answer_input_name).toMatch(/^unipus:choice:/);
  });
});

describe('fillUnipusAnswer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('填空：按索引填入', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const r = fillUnipusAnswer(document, 'unipus:fill:0', ['technology']);
    expect(r.status).toBe('filled');
    const ins = document.querySelectorAll<HTMLInputElement>('.comp-abs-input input');
    expect(ins[0]!.value).toBe('technology');
    expect(ins[1]!.value).toBe('');
  });

  test('选择：根据 caption 点击对应选项', () => {
    document.body.innerHTML = CHOICE_HTML;
    const captions = 'A|B|C|D';
    const r = fillUnipusAnswer(document, `unipus:choice:0:${captions}`, ['B']);
    expect(r.status).toBe('filled');
  });

  test('错误 selector 返回 not_found', () => {
    const r = fillUnipusAnswer(document, 'unipus:.nonexistent', ['x']);
    expect(r.status).toBe('not_found');
  });

  test('非 unipus: 前缀返回 not_found', () => {
    const r = fillUnipusAnswer(document, 'chaoxing:something', ['x']);
    expect(r.status).toBe('not_found');
  });
});
