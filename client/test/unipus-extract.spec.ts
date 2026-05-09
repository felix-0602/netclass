// U 校园题目提取 + 填入测试
// 使用精简 HTML 模拟真实 DOM 结构（happy-dom 对大 fixture 解析有限）

import { describe, expect, test, beforeEach } from 'vitest';
import { extractQuestionsFromUnipus, fillUnipusAnswer } from '../src/adapters/unipus';

const FILL_BLANK_HTML = `
<div class="question-common-abs-question-container">
  <div class="abs-direction">
    <span class="title">Directions:</span>
    <div class="content">Listen to the passage and fill in the blanks.</div>
  </div>
  <div class="question-common-abs-reply">
    <div class="question-common-abs-scoop comp-scoop-reply fill-blank-reply">
      <div class="item">
        <div class="component-htmlview">
          <p>China's efforts to narrow the technology gap</p>
          <table>
            <tr><td><strong>Education</strong></td></tr>
            <tr><td>
              <p>Lack of <span class="question-number">1</span>
              <div class="comp-abs-input input-user-answer input-can-focus">
                <div class="placeholder"></div>
                <input value="" type="text">
              </div>
              limits many students' access.</p>
            </td></tr>
            <tr><td>
              <p>Internet companies provide <span class="question-number">2</span>
              <div class="comp-abs-input input-user-answer input-can-focus">
                <input value="" type="text">
              </div>
              and online education programs.</p>
            </td></tr>
            <tr><td>
              <p>AI-powered <span class="question-number">3</span>
              <div class="comp-abs-input input-user-answer input-can-focus">
                <input value="" type="text">
              </div>
              helps narrow the gap further.</p>
            </td></tr>
          </table>
        </div>
      </div>
    </div>
  </div>
  <audio class="unipus-audio-h5" src="https://ucontent.cdn.unipus.cn/test.mp3#duration=120"></audio>
</div>`;

describe('extractQuestionsFromUnipus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('提取填空型听力练习：3 个 input → 3 道题', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const questions = extractQuestionsFromUnipus(document);

    expect(questions.length).toBe(3);
    for (const q of questions) {
      expect(q.platform).toBe('unipus');
      expect(q.type).toBe('fill');
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.answer_target.answer_input_name).toMatch(/^unipus:/);
    }
  });

  test('音频 URL 被提取到 images', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const questions = extractQuestionsFromUnipus(document);
    const withAudio = questions.filter((q) => q.images.length > 0);
    expect(withAudio.length).toBe(3);
  });

  test('题干包含 Directions 前缀', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const questions = extractQuestionsFromUnipus(document);
    expect(questions[0]!.text).toContain('Listen to the passage');
  });

  test('空文档返回空数组', () => {
    const questions = extractQuestionsFromUnipus(document);
    expect(questions).toEqual([]);
  });
});

describe('fillUnipusAnswer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('根据 selector 填入答案', () => {
    document.body.innerHTML = FILL_BLANK_HTML;
    const qs = extractQuestionsFromUnipus(document);
    expect(qs.length).toBeGreaterThan(0);

    const result = fillUnipusAnswer(
      document,
      qs[0]!.answer_target.answer_input_name!,
      ['technology resources'],
    );
    expect(result.status).toBe('filled');

    // 验证值被写入
    const inputs = document.querySelectorAll<HTMLInputElement>('.comp-abs-input input');
    expect(inputs[0]!.value).toBe('technology resources');
    expect(inputs[1]!.value).toBe('');
    expect(inputs[2]!.value).toBe('');
  });

  test('错误的 selector 返回 not_found', () => {
    const result = fillUnipusAnswer(document, 'unipus:.nonexistent', ['x']);
    expect(result.status).toBe('not_found');
  });

  test('非 unipus: 前缀返回 not_found', () => {
    const result = fillUnipusAnswer(document, 'chaoxing:something', ['x']);
    expect(result.status).toBe('not_found');
  });
});
