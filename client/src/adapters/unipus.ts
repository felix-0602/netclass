// U 校园 adapter — 题目提取 + 答案填入
//
// 基于 2026-05-09 端到端浏览器实测（Chrome headed + gstack browse）：
//   - 主站 uai.unipus.cn：课程列表、作业列表、学习记录
//   - 内容站 ucontent.unipus.cn：实际题目渲染
//
// 实测 DOM 结构（Unit test 页）：
//
//   选择题：.question-common-abs-reply > .question-common-abs-choice
//     ├── .ques-title p          → 题号 "1."
//     └── .option-wrap > .option → .caption (A/B/C/D) + .content (选项文本)
//
//   填空题：.question-common-abs-reply > .fill-blank-reply
//     └── .item > .question-number + .comp-abs-input > input
//
//   音频：  audio.unipus-audio-h5 (CDN URL, duration 在 hash 里)
//
// 与超星差异：SPA 无 iframe、无字体混淆、无数学公式图、多个 question 在同一 reply 下

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
 * 通过 .question-common-abs-reply 的直接子元素判断题型并逐个解析。
 */
export function extractQuestionsFromUnipus(
  root: Document | ShadowRoot = document,
): ExtractedQuestion[] {
  const containers = root.querySelectorAll('.question-common-abs-question-container');
  const out: ExtractedQuestion[] = [];

  containers.forEach((container) => {
    const questions = parseContainer(container as HTMLElement, out.length);
    out.push(...questions);
  });

  return out;
}

function parseContainer(
  container: HTMLElement,
  startIdx: number,
): ExtractedQuestion[] {
  // Direction / 题目说明
  const directionEl = container.querySelector('.abs-direction .content');
  const directionText = directionEl?.textContent?.trim() ?? '';

  // 音频 URL
  const audioEl = container.querySelector<HTMLAudioElement>('audio.unipus-audio-h5');
  const audioUrl = audioEl?.getAttribute('src')
    ?? audioEl?.querySelector('source')?.getAttribute('src')
    ?? undefined;

  // reply 区 — 所有题目都在这里
  const replyEl = container.querySelector('.question-common-abs-reply');
  if (!replyEl) return [];

  const questions: ExtractedQuestion[] = [];

  // 遍历 reply 的直接子元素 — 每个子元素是一道题
  const items = replyEl.children;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as HTMLElement;
    const cls = item.className;

    if (cls.includes('question-common-abs-choice') || cls.includes('choice')) {
      // ── 选择题 ──
      const q = parseChoiceQuestion(item, container, startIdx + i, directionText, audioUrl);
      if (q) questions.push(q);
    } else if (cls.includes('fill-blank-reply') || cls.includes('comp-scoop-reply')) {
      // ── 填空题 ──
      const qs = parseFillBlankItem(item, container, startIdx + questions.length, directionText, audioUrl);
      questions.push(...qs);
    }
  }

  return questions;
}

/** 解析一道选择题 */
function parseChoiceQuestion(
  item: HTMLElement,
  container: HTMLElement,
  idx: number,
  directionText: string,
  audioUrl: string | undefined,
): ExtractedQuestion | null {
  const stemEl = item.querySelector('.ques-title');
  const stem = stemEl?.textContent?.trim() ?? '';

  const optionEls = item.querySelectorAll('.option');
  const options: Array<{ label: string; text: string | null; image_ref: string | null }> = [];
  const optionCaptions: string[] = [];

  optionEls.forEach((opt) => {
    const cap = opt.querySelector('.caption')?.textContent?.trim() ?? '';
    const content = opt.querySelector('.content')?.textContent?.trim() ?? '';
    optionCaptions.push(cap);
    options.push({ label: cap, text: content, image_ref: null });
  });

  const text = directionText ? `[${directionText}] ${stem}` : stem;

  // answer_target 存储 captions 数组，供 fill 阶段查找
  return {
    platform_id: makePlatformId(container, idx),
    platform: 'unipus',
    type: 'single',
    text: text.slice(0, 1000),
    options,
    tex_spans: [],
    images: audioUrl ? [audioUrl] : [],
    context: {},
    answer_target: {
      answer_input_name: `unipus:choice:${idx}:${optionCaptions.join('|')}`,
      answer_type_input_name: undefined,
    },
  };
}

/** 解析填空题 reply — 每个 .comp-abs-input input 是一道题 */
function parseFillBlankItem(
  item: HTMLElement,
  container: HTMLElement,
  startIdx: number,
  directionText: string,
  audioUrl: string | undefined,
): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];
  const inputs = item.querySelectorAll<HTMLInputElement>('.comp-abs-input input, input[type="text"]');

  inputs.forEach((input, i) => {
    const numEl = findNearbyQuestionNumber(input);
    const num = numEl?.textContent?.trim() ?? `${i + 1}`;
    const rowText = extractRowContext(input);

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
        answer_input_name: `unipus:fill:${startIdx + i}`,
        answer_type_input_name: undefined,
      },
    });
  });

  return questions;
}

/** 查找 input 附近的 .question-number */
function findNearbyQuestionNumber(input: HTMLInputElement): HTMLElement | null {
  let el: HTMLElement | null = input.parentElement;
  for (let d = 0; d < 6 && el; d++) {
    const num = el.querySelector('.question-number');
    if (num) return num as HTMLElement;
    let prev = el.previousElementSibling as HTMLElement | null;
    while (prev) {
      const n = prev.querySelector?.('.question-number');
      if (n) return n as HTMLElement;
      prev = prev.previousElementSibling as HTMLElement | null;
    }
    el = el.parentElement;
  }
  return null;
}

/** 提取 input 所在行的文本上下文 */
function extractRowContext(input: HTMLInputElement): string {
  const item = input.closest('.item');
  if (item) {
    const hv = item.querySelector('.component-htmlview');
    return (hv?.textContent ?? item.textContent ?? '').trim().slice(0, 300);
  }
  const parent = input.closest('td, div');
  return (parent?.textContent ?? '').replace(input.value, '').trim().slice(0, 200);
}

function makePlatformId(container: HTMLElement, idx: number): string {
  const id = container.getAttribute('data-id') ?? container.getAttribute('id') ?? `unipus-${idx}`;
  return `${id}-q${idx}`;
}

// ═══════════════════════════════════════════════
// 答案填入
// ═══════════════════════════════════════════════

/**
 * answer_input_name 格式：
 *   "unipus:choice:<idx>:<A|B|C|D>" — 选择题，caption 用 | 分隔
 *   "unipus:fill:<idx>"            — 填空题，按索引找 input
 */
export function fillUnipusAnswer(
  root: Document | ShadowRoot,
  answerTargetName: string,
  answers: string[],
): { status: 'filled' | 'not_found'; message?: string } {
  if (!answerTargetName.startsWith('unipus:')) {
    return { status: 'not_found', message: '非 U 校园格式' };
  }

  const parts = answerTargetName.slice('unipus:'.length).split(':');
  const mode = parts[0];  // "choice" | "fill"
  const answer = answers[0];
  if (!answer) return { status: 'not_found', message: '没有答案' };

  if (mode === 'choice') {
    return fillChoiceByCaption(root, parts.slice(2).join(':'), answer);
  }
  if (mode === 'fill') {
    const idx = parseInt(parts[1] ?? '0', 10);
    return fillByIndex(root, idx, answer);
  }
  return { status: 'not_found', message: `未知模式: ${mode}` };
}

/** 选择题：根据 caption 找到对应的 .option 并点击 */
function fillChoiceByCaption(
  root: Document | ShadowRoot,
  captionsStr: string,
  answer: string,
): { status: 'filled' | 'not_found'; message?: string } {
  // answer 可能是 "A" / "B" / "C" / "D" 或 "A,C"（多选）
  const targetLabels = answer.split(',').map((s) => s.trim());

  // 在所有 option 中找匹配的
  const allOptions = root.querySelectorAll('.option');
  let clicked = 0;

  for (const opt of allOptions) {
    const cap = opt.querySelector('.caption')?.textContent?.trim() ?? '';
    if (targetLabels.includes(cap)) {
      (opt as HTMLElement).click();
      clicked++;
    }
  }

  if (clicked > 0) {
    return { status: 'filled' };
  }
  return { status: 'not_found', message: `找不到匹配选项: ${answer} (captions=${captionsStr})` };
}

/** 填空题：按序号找 input 并填入值 */
function fillByIndex(
  root: Document | ShadowRoot,
  idx: number,
  value: string,
): { status: 'filled' | 'not_found'; message?: string } {
  const inputs = root.querySelectorAll<HTMLInputElement>('.comp-abs-input input, input[type="text"]');
  if (idx >= inputs.length) {
    return { status: 'not_found', message: `input 索引越界: ${idx}/${inputs.length}` };
  }
  setNativeValue(inputs[idx]!, value);
  return { status: 'filled' };
}

/** 原生 value setter + 事件派发，让 React 感知变化 */
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
