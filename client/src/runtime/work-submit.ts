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
  /** TiMu 容器 */
  timu: HTMLElement;
  /** 服务端 hash 应当由调用方算（这里只给出 input name 供索引） */
  inputName: string | null;
  /** correct: 对; wrong: 错; unknown: 看不出 */
  correct: 'correct' | 'wrong' | 'unknown';
  /** 命中的 marker selector / aria 提示，调试用 */
  evidence: string;
}

// chaoxing 批改 marker — 实测 2026-04 高数 1.1 章节测验已答题：
//   容器: <div class="CorrectOrNot fl">
//     对: <span class="marking_dui">  (duì = 对)
//     错: <span class="marking_cuo">  (cuò = 错)
// 旧版 chaoxing 用过 .zybcorrect/.zybwrong，留作 fallback
const CORRECT_MARKERS = [
  '.CorrectOrNot .marking_dui',
  '.marking_dui',
  '.zybcorrect',
  '.markCorrect',
];

const WRONG_MARKERS = [
  '.CorrectOrNot .marking_cuo',
  '.marking_cuo',
  '.zybwrong',
  '.markWrong',
  '.cuoti',
];

/**
 * 读取作业 doc 里每道题的批改对错。
 * 提交后 chaoxing 会 reload work 页（or 部分 in-place 渲染 marker）— 调用方应在 submit
 * 完成 + 等待若干秒后调用本函数。
 */
export function readMarks(workDocOrFrame: Document | HTMLIFrameElement): QuestionMark[] {
  const workDoc: Document | null =
    workDocOrFrame instanceof HTMLIFrameElement
      ? (workDocOrFrame as HTMLIFrameElement).contentDocument
      : workDocOrFrame;
  if (!workDoc) return [];
  const out: QuestionMark[] = [];
  const timus = workDoc.querySelectorAll<HTMLElement>('.TiMu');
  for (const t of Array.from(timus)) {
    const inputName = t.querySelector<HTMLInputElement>('input[name^="answer"]')?.name ?? null;
    let correct: QuestionMark['correct'] = 'unknown';
    let evidence = '';

    for (const sel of CORRECT_MARKERS) {
      if (t.querySelector(sel)) {
        correct = 'correct';
        evidence = `correct:${sel}`;
        break;
      }
    }
    if (correct === 'unknown') {
      for (const sel of WRONG_MARKERS) {
        if (t.querySelector(sel)) {
          correct = 'wrong';
          evidence = `wrong:${sel}`;
          break;
        }
      }
    }
    // 兜底：看 .TiMu 自身 class
    if (correct === 'unknown') {
      if (t.classList.contains('cuoti') || t.classList.contains('answerWrong')) {
        correct = 'wrong';
        evidence = 'timu-class:wrong';
      } else if (t.classList.contains('answerRight')) {
        correct = 'correct';
        evidence = 'timu-class:right';
      }
    }

    out.push({ timu: t, inputName, correct, evidence });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
