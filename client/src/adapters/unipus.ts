// U 校园 adapter — 题目提取 + 答案填入
//
// 基于 2026-05-09 端到端浏览器实测 DOM 结构：
//   - 主站 uai.unipus.cn：课程列表、作业列表、学习记录
//   - 内容站 ucontent.unipus.cn：实际题目渲染
//
// 题目容器：.question-common-abs-question-container
// 填空输入：.comp-abs-input > input
// 音频元素：audio.unipus-audio-h5（CDN URL + hash 含 duration）
//
// 与超星关键差异：
//   - 无 iframe 嵌套（SPA 同域）
//   - 无字体混淆
//   - 无数学公式图片（纯英语平台）
//   - 有听力题（需 Whisper STT，Phase 2）
//   - 一个 exercise 含多个填空 → 拆为多道 ExtractedQuestion

import type { ExtractedQuestion } from './types';

let activityTimer: ReturnType<typeof setTimeout> | null = null;

export function bootUnipus(rootDoc: Document = document): () => void {
  console.info('[netclass-sidekick/unipus] adapter 启动');
  startActivitySimulator(rootDoc);
  return () => {
    if (activityTimer != null) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }
  };
}

function startActivitySimulator(rootDoc: Document) {
  const fire = () => {
    rootDoc.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 100 + Math.random() * 600,
        clientY: 100 + Math.random() * 400,
        bubbles: true,
      }),
    );
    activityTimer = setTimeout(fire, 3 * 60_000 + (Math.random() - 0.5) * 60_000);
  };
  activityTimer = setTimeout(fire, 3 * 60_000);
}

/**
 * 从 U 校园页面提取所有题目。
 * 一个 exercise（.question-common-abs-question-container）可能含多个填空，
 * 每个填空拆成独立的 ExtractedQuestion。
 */
export function extractQuestionsFromUnipus(
  root: Document | ShadowRoot = document,
): ExtractedQuestion[] {
  const containers = root.querySelectorAll('.question-common-abs-question-container');
  const out: ExtractedQuestion[] = [];

  containers.forEach((container) => {
    const questions = parseExerciseContainer(container as HTMLElement, out.length);
    out.push(...questions);
  });

  return out;
}

function parseExerciseContainer(
  container: HTMLElement,
  startIdx: number,
): ExtractedQuestion[] {
  // 提取 Direction
  const directionEl = container.querySelector('.abs-direction .content');
  const directionText = directionEl?.textContent?.trim() ?? '';

  // 提取音频 URL
  const audioEl = container.querySelector<HTMLAudioElement>('audio.unipus-audio-h5');
  const audioUrl = audioEl?.getAttribute('src')
    ?? audioEl?.querySelector('source')?.getAttribute('src')
    ?? undefined;

  // 判断题型：填空 / 选择
  const replyEl = container.querySelector('.question-common-abs-reply');
  if (!replyEl) return [];

  const isFillBlank = !!replyEl.querySelector('.fill-blank-reply, .comp-abs-input');

  const questions: ExtractedQuestion[] = [];

  if (isFillBlank) {
    // 每个 input 拆成一道题
    const inputs = replyEl.querySelectorAll<HTMLInputElement>(
      '.comp-abs-input input, input[type="text"]:not([style*="display: none"])',
    );
    inputs.forEach((input, i) => {
      const numEl = findPrevQuestionNumber(input);
      const num = numEl?.textContent?.trim() ?? `${i + 1}`;

      // 从 input 周围提取题目文本
      const rowText = extractRowText(input);

      questions.push({
        platform_id: makePlatformId(container, startIdx + i),
        platform: 'unipus',
        type: 'fill',
        text: directionText
          ? `[${directionText}] ${num}. ${rowText}`
          : `${num}. ${rowText}`,
        options: [],
        tex_spans: [],
        images: audioUrl ? [audioUrl] : [],
        context: {},
        answer_target: {
          answer_input_name: `unipus:${selectorFor(input)}`,
          answer_type_input_name: undefined,
        },
      });
    });
  } else {
    // 选择题（暂无 fixture，按通用结构提取）
    const choiceGroups = replyEl.querySelectorAll('.question-common-abs-scoop, [class*="choice-group"]');
    choiceGroups.forEach((group, i) => {
      const stem = group.querySelector('[class*="stem"], .component-htmlview')?.textContent?.trim() ?? '';
      const optionEls = group.querySelectorAll('[class*="option"], .ant-radio, .ant-checkbox');
      const options = Array.from(optionEls).map((opt) => {
        const label = opt.getAttribute('data-label') ?? '';
        const text = opt.textContent?.trim() ?? '';
        return { label, text, image_ref: null as string | null };
      });

      questions.push({
        platform_id: makePlatformId(container, startIdx + i),
        platform: 'unipus',
        type: options.length > 0 ? 'single' : 'fill',
        text: stem.slice(0, 1000),
        options,
        tex_spans: [],
        images: audioUrl ? [audioUrl] : [],
        context: {},
        answer_target: {
          answer_input_name: `unipus:${startIdx + i}`,
          answer_type_input_name: undefined,
        },
      });
    });
  }

  return questions;
}

/** 查找当前 input 前面的 question-number span */
function findPrevQuestionNumber(input: HTMLInputElement): HTMLElement | null {
  let el: HTMLElement | null = input.parentElement;
  for (let depth = 0; depth < 6 && el; depth++) {
    const num = el.querySelector('.question-number');
    if (num) return num as HTMLElement;
    // 也检查同级前面的元素
    let prev = el.previousElementSibling as HTMLElement | null;
    while (prev) {
      const numInPrev = prev.querySelector?.('.question-number');
      if (numInPrev) return numInPrev as HTMLElement;
      prev = prev.previousElementSibling as HTMLElement | null;
    }
    el = el.parentElement;
  }
  return null;
}

/** 提取 input 所在行的上下文文本 */
function extractRowText(input: HTMLInputElement): string {
  // 从最近的父级 .item 或行容器提取
  const item = input.closest('.item');
  if (item) {
    const htmlView = item.querySelector('.component-htmlview');
    if (htmlView) return htmlView.textContent?.trim().slice(0, 300) ?? '';
    return item.textContent?.trim().slice(0, 300) ?? '';
  }
  // fallback: input 前面的兄弟文本
  const parent = input.closest('td, div, .comp-abs-input');
  if (parent) return parent.textContent?.replace(input.value, '').trim().slice(0, 200) ?? '';
  return '';
}

function makePlatformId(container: HTMLElement, idx: number): string {
  const hash = container.getAttribute('data-id')
    ?? container.getAttribute('id')
    ?? `unipus-${idx}`;
  return `${hash}-q${idx}`;
}

function selectorFor(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute('name');
  if (name) return `input[name="${name.replace(/"/g, '\\"')}"]`;
  const classes = Array.from(el.classList).map((c) => `.${CSS.escape(c)}`).join('');
  if (classes) return classes;
  return el.tagName.toLowerCase();
}

/**
 * 填入 U 校园答案。
 * answer_target.answer_input_name 格式为 "unipus:<selector>"
 */
export function fillUnipusAnswer(
  root: Document | ShadowRoot,
  answerTargetName: string,
  answers: string[],
): { status: 'filled' | 'not_found'; message?: string } {
  if (!answerTargetName.startsWith('unipus:')) {
    return { status: 'not_found', message: '非 U 校园格式的 answer_target' };
  }

  const selector = answerTargetName.slice('unipus:'.length);
  const answer = answers[0];
  if (!answer) return { status: 'not_found', message: '没有答案' };

  try {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (!input) {
      // 尝试更宽松的匹配
      const allInputs = root.querySelectorAll<HTMLInputElement>(
        '.comp-abs-input input, input[type="text"]',
      );
      const idx = parseInt(selector.replace(/\D/g, ''), 10);
      if (!isNaN(idx) && idx < allInputs.length) {
        setNativeValue(allInputs[idx]!, answer);
        return { status: 'filled' };
      }
      return { status: 'not_found', message: `找不到 input: ${selector}` };
    }
    setNativeValue(input, answer);
    return { status: 'filled' };
  } catch (e) {
    return { status: 'not_found', message: (e as Error).message };
  }
}

/** 原生 value setter 触发 React change 事件 */
function setNativeValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}
