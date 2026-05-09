// chaoxing 作业提交 + 批改结果读取
//
// 流程：
//   1. 找 .btnSubmit (onclick=btnBlueSubmit) 点击
//   2. chaoxing 弹"确认提交"对话框 → 找 onclick=submitCheckTimes 点确认
//   3. 等服务端响应 + 页面刷新（chaoxing 会 reload 显示批改结果）
//   4. 重新提取 TiMu，每道题读批改 marker（对/错）
//
// 注意：本模块只做 chaoxing 工作 — server-side 验证回写由调用方做
// （读完 markings → 调 /admin/verify-answer { hash, correct }）

import { sleep } from '../lib/sleep';

export type SubmitResult =
  | { status: 'submitted'; selector: string; redoPrompt?: string }
  | { status: 'no-button' }
  | { status: 'cancelled'; reason: string };

const SUBMIT_BUTTON_SELECTORS = [
  'a.btnSubmit.workBtnIndex',
  'a.btnSubmit',
  'a[onclick*="btnBlueSubmit"]',
  'a[onclick*="submitCheckTimes"]',
];

// 实测 2026-04 高数：二次确认 popup 在 **top studentstudy doc**（不是 work iframe）
// 容器 .popDiv.wid440.Marking + .maskDiv，文本 "您还有未做完..." 或 "确认提交？"
// 按钮 onclick 为空（jQuery 绑事件），区分提交/取消靠 class：
//   提交 = a.jb_btn.jb_btn_92.fs14 (无 .btn_92_cancel 无 .popClose)
//   取消 = a.btnBlue.btn_92_cancel
//   关闭 = a.popClose
const CONFIRM_POPUP_CONTAINER_SELECTORS = [
  '.popDiv.wid440.Marking',
  '.maskDiv',
  '.popDiv', // 兼容旧版
];

const CONFIRM_BUTTON_SELECTORS = [
  // 实测 2026-04 命中 — popup 内"提交"按钮（class 含 jb_btn 不含 cancel）
  '.popDiv.wid440.Marking a.jb_btn.jb_btn_92:not(.btn_92_cancel):not(.popClose)',
  // 旧版 chaoxing 兼容
  'a[onclick*="submitCheckTimes"]',
  'a[onclick*="bigBookSubmit"]',
];

/**
 * 提交后 chaoxing 可能弹"未到及格线，请重做"反馈。这种 popup 出现 = 提交成功了，
 * 但分数不够。**不要**点重做（会清空答案重来）— 让用户决定。
 * 这里只检测，不操作。
 */
const REDO_FEEDBACK_PATTERNS = [
  /未到及格/,
  /未及格/,
  /请重做/,
  /分数过低/,
  /未通过/,
];

function detectRedoPrompt(doc: Document): string | null {
  // 找可见 popup 含"未及格/重做"文本的
  const pops = doc.querySelectorAll<HTMLElement>('.popDiv, .maskDiv, .layui-layer');
  for (const p of Array.from(pops)) {
    if (!isVisible(p)) continue;
    const txt = (p.textContent || '').trim();
    for (const re of REDO_FEEDBACK_PATTERNS) {
      if (re.test(txt)) return txt.slice(0, 80);
    }
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  try {
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  } catch {
    /* happy-dom 偶发抛异常 */
  }
  return true;
}

function findVisibleButton(
  doc: Document,
  selectors: readonly string[],
): { el: HTMLElement; selector: string } | null {
  for (const sel of selectors) {
    const els = doc.querySelectorAll<HTMLElement>(sel);
    for (const el of Array.from(els)) {
      if (isVisible(el)) return { el, selector: sel };
    }
  }
  return null;
}

/** 沿 frame 链上行找 top doc（chaoxing 弹窗一般在 top studentstudy doc，不在 work iframe） */
function getTopDoc(doc: Document): Document {
  try {
    const win = doc.defaultView;
    return win?.top?.document ?? doc;
  } catch {
    return doc;
  }
}

/** 在 top doc 找可见的二次确认 popup 容器 */
function findConfirmPopupRoot(topDoc: Document): HTMLElement | null {
  for (const sel of CONFIRM_POPUP_CONTAINER_SELECTORS) {
    const els = topDoc.querySelectorAll<HTMLElement>(sel);
    for (const el of Array.from(els)) {
      if (isVisible(el)) return el;
    }
  }
  return null;
}

/**
 * 提交当前 work iframe 里的作业。
 *
 * @param workDoc 作业题目 document（doHomeWorkNew 的内层 frame_content doc）
 * @param opts.confirmDelayMs 主提交按钮点完后等多久点二次确认（chaoxing 通常 < 1s 弹）
 */
export async function submitWork(
  workDoc: Document,
  opts: { confirmDelayMs?: number } = {},
): Promise<SubmitResult> {
  const { confirmDelayMs = 800 } = opts;

  const main = findVisibleButton(workDoc, SUBMIT_BUTTON_SELECTORS);
  if (!main) return { status: 'no-button' };

  // 抑制提交时可能的 alert / confirm（chaoxing 偶尔弹"确认提交?"）
  const win = workDoc.defaultView;
  const restoreAlert = win && tryOverrideDialogs(win);

  try {
    main.el.click();
    await sleep(confirmDelayMs);

    // 二次确认 popup 在 top studentstudy doc（不在 work iframe）— 上行找
    const topDoc = getTopDoc(workDoc);
    let popupRoot = findConfirmPopupRoot(topDoc);

    // 防御：popup 没出现就别点（避免误触别的"提交"按钮）
    if (popupRoot) {
      const confirm = findVisibleButton(topDoc, CONFIRM_BUTTON_SELECTORS);
      if (confirm && confirm.el !== main.el) {
        confirm.el.click();
        await sleep(confirmDelayMs); // 等服务端响应可能再弹"未及格"提示
      }
    }

    // 检测"未到及格线请重做"反馈 — 不操作，仅报告（也走 top doc）
    const redoPrompt = detectRedoPrompt(topDoc);

    return redoPrompt
      ? { status: 'submitted', selector: main.selector, redoPrompt }
      : { status: 'submitted', selector: main.selector };
  } finally {
    restoreAlert?.();
  }
}

function tryOverrideDialogs(win: Window): () => void {
  const origAlert = win.alert;
  const origConfirm = win.confirm;
  try {
    win.alert = () => {};
    win.confirm = () => true;
  } catch {
    return () => {};
  }
  return () => {
    try {
      win.alert = origAlert;
      win.confirm = origConfirm;
    } catch {
      /* ignore */
    }
  };
}

// ===== 批改结果读取 =====

export interface QuestionMark {
  /** 题目容器（可能为 ans-cc div，不一定是 .TiMu） */
  timu: HTMLElement;
  /** 服务端 hash 应当由调用方算（这里只给出 input name 供索引） */
  inputName: string | null;
  /** correct: 对; wrong: 错; unknown: 看不出 */
  correct: 'correct' | 'wrong' | 'unknown';
  /** 命中的 marker selector / aria 提示，调试用 */
  evidence: string;
}

// chaoxing 批改 marker — 覆盖三种版本：
//   新版: .font_dui / .font_cuoti / .CycCorrect / .CycWrong
//   标准: .marking_dui / .marking_cuo
//   旧版: .zybcorrect / .zybwrong / .markCorrect / .markWrong
const CORRECT_MARKERS = [
  '.CorrectOrNot .marking_dui',
  '.marking_dui',
  '.zybcorrect',
  '.markCorrect',
  '.font_dui',
  '.CycCorrect',
  '.answerRight',
  '.ans-ok',
];

const WRONG_MARKERS = [
  '.CorrectOrNot .marking_cuo',
  '.marking_cuo',
  '.zybwrong',
  '.markWrong',
  '.cuoti',
  '.font_cuoti',
  '.CycWrong',
  '.answerWrong',
  '.ans-err',
];

/** 递归收集所有可访问的 Document（含嵌套同源 iframe） */
function collectDocs(root: Document): Document[] {
  const docs: Document[] = [root];
  try {
    root.querySelectorAll('iframe').forEach((f) => {
      try {
        const d = (f as HTMLIFrameElement).contentDocument;
        if (d) docs.push(...collectDocs(d));
      } catch { /* cross-origin */ }
    });
  } catch { /* DOM exception */ }
  return docs;
}

/**
 * 读取作业 doc 里每道题的批改对错。
 * 递归搜索所有嵌套 iframe，覆盖 .TiMu 答题视图和 ans-cc 批改视图。
 */
export function readMarks(workDocOrFrame: Document | HTMLIFrameElement): QuestionMark[] {
  const rootDoc: Document | null =
    workDocOrFrame instanceof HTMLIFrameElement
      ? (workDocOrFrame as HTMLIFrameElement).contentDocument
      : workDocOrFrame;
  if (!rootDoc) return [];

  // 递归收集所有嵌套 doc，在其中搜索题目和标记
  const allDocs = collectDocs(rootDoc);
  const out: QuestionMark[] = [];

  // 在所有 doc 中找 TiMu 或 ans-cc 容器
  for (const doc of allDocs) {
    const containers = doc.querySelectorAll<HTMLElement>('.TiMu, .ans-cc');
    for (const c of Array.from(containers)) {
      // 跳过已处理的（多 doc 搜索可能重复）
      if (out.some((m) => m.timu === c)) continue;

      const inputName = c.querySelector<HTMLInputElement>('input[name^="answer"]')?.name ?? null;
      let correct: QuestionMark['correct'] = 'unknown';
      let evidence = '';

      for (const sel of CORRECT_MARKERS) {
        if (c.querySelector(sel)) {
          correct = 'correct';
          evidence = `correct:${sel}`;
          break;
        }
      }
      if (correct === 'unknown') {
        for (const sel of WRONG_MARKERS) {
          if (c.querySelector(sel)) {
            correct = 'wrong';
            evidence = `wrong:${sel}`;
            break;
          }
        }
      }
      // 兜底：看容器自身 class
      if (correct === 'unknown') {
        if (c.classList.contains('cuoti') || c.classList.contains('answerWrong')) {
          correct = 'wrong';
          evidence = 'class:wrong';
        } else if (c.classList.contains('answerRight')) {
          correct = 'correct';
          evidence = 'class:right';
        }
      }
      // 最后兜底：读 aria-label
      if (correct === 'unknown') {
        const ariaEl = c.querySelector<HTMLElement>('[aria-label]');
        const aria = ariaEl?.getAttribute('aria-label') ?? '';
        if (/正确|correct|✓/.test(aria)) { correct = 'correct'; evidence = `aria:${aria.slice(0,20)}`; }
        else if (/错误|wrong|✗/.test(aria)) { correct = 'wrong'; evidence = `aria:${aria.slice(0,20)}`; }
      }

      out.push({ timu: c, inputName, correct, evidence });
    }
  }

  return out;
}

/**
 * 带重试的 readMarks：若全部 unknown，等 delayMs 后重试，最多 retries 次。
 * 解决 ExtJS 批改视图异步渲染后 marker 尚未出现的问题。
 */
export async function readMarksWithRetry(
  workDocOrFrame: Document | HTMLIFrameElement,
  retries = 2,
  delayMs = 800,
): Promise<QuestionMark[]> {
  let marks = readMarks(workDocOrFrame);
  for (let i = 0; i < retries && marks.length > 0 && marks.every((m) => m.correct === 'unknown'); i++) {
    await sleep(delayMs);
    marks = readMarks(workDocOrFrame);
  }
  return marks;
}


