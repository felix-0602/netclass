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
  | { status: 'submitted'; selector: string }
  | { status: 'no-button' }
  | { status: 'cancelled'; reason: string };

const SUBMIT_BUTTON_SELECTORS = [
  'a.btnSubmit.workBtnIndex',
  'a.btnSubmit',
  'a[onclick*="btnBlueSubmit"]',
  'a[onclick*="submitCheckTimes"]',
];

const CONFIRM_BUTTON_SELECTORS = [
  // 二次确认 popup 里的"确定"按钮
  'a[onclick*="submitCheckTimes"]',
  '.popDiv a.btnBlue',
  '.popDiv .btn_92_cancel',
];

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

    // 找二次确认按钮（如果出现）
    const confirm = findVisibleButton(workDoc, CONFIRM_BUTTON_SELECTORS);
    if (confirm && confirm.el !== main.el) {
      confirm.el.click();
    }

    return { status: 'submitted', selector: main.selector };
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

// chaoxing 批改 marker 候选 — 多套尝试，命中即采纳
// 实测 2026-04 高数：未确认实际 marker 类名，先写常见模式 + 用户实测调整
const CORRECT_MARKERS = [
  '.zybcorrect',
  '.Zy_correct',
  '.markCorrect',
  '.right_icon',
  // chaoxing 偶尔在题号旁加 <font color="green">✓</font>
  'font[color="green"]',
  'i.icon-right',
];

const WRONG_MARKERS = [
  '.zybwrong',
  '.Zy_wrong',
  '.markWrong',
  '.wrong_icon',
  '.cuoti',
  'font[color="red"]',
  'i.icon-wrong',
];

/**
 * 读取作业 doc 里每道题的批改对错。
 * 提交后 chaoxing 会 reload work 页（or 部分 in-place 渲染 marker）— 调用方应在 submit
 * 完成 + 等待若干秒后调用本函数。
 */
export function readMarks(workDoc: Document): QuestionMark[] {
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
