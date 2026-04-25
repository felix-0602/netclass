// chaoxing 弹窗 handler
//
// 触发场景（实测 2026-04 高数课）：
//   - 进入未完成章节 chaoxing 自动 popup："上一章未完成，是否继续学习"
//   - jumpNext 触发 #prevNextFocusNext 后，本章有未完成任务点 → 弹窗 "继续学习" 拦截
//
// 弹窗确认按钮 selector 撞 .nextChapter（同名 class），所以**必须**先确认弹窗容器存在 + 可见
// 才能点，否则会误把页面正常的"下一章节"按钮当弹窗按钮点。

export interface PopupConfig {
  /** 弹窗容器 selector — 用来判断"弹窗确实出现了" */
  containerSelectors?: string[];
  /** 弹窗确认按钮 selector 列表（按优先级） */
  confirmSelectors?: string[];
}

export type PopupResult =
  | { status: 'confirmed'; container: string; confirm: string }
  | { status: 'no-popup' }
  | { status: 'no-confirm-button'; container: string };

const DEFAULT_CONTAINER_SELECTORS = [
  // chaoxing jb_dialog（实测命中 — 高数课"未完成任务"弹窗）
  '.jb_dialog',
  // chaoxing layui 风格弹窗
  '.layui-layer-dialog',
  // 兜底：常见 modal 容器
  '#chapterTaskDialog',
];

const DEFAULT_CONFIRM_SELECTORS = [
  // 实测：a.jb_btn.jb_btn_92.fr.fs14.nextChapter（高数课弹窗，size 92x36）
  'a.jb_btn.jb_btn_92.fr.fs14.nextChapter',
  '.jb_dialog .nextChapter',
  '.jb_dialog .jb_btn',
  '.layui-layer-btn0',
];

function isVisible(el: HTMLElement): boolean {
  if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    } catch {
      // happy-dom 偶发抛异常 — 忽略
    }
  }
  return true;
}

/**
 * 检测 chaoxing 弹窗 + 安全点确认。
 *
 * 仅在容器出现且可见的前提下点击 — 防止误触正常的"下一章节"按钮。
 * 优先在容器范围内找按钮；找不到再到 root 全局兜底（容器存在 = 点击安全）。
 */
export function detectAndConfirmPopup(
  root: Document = document,
  opts: PopupConfig = {},
): PopupResult {
  const containerSelectors = opts.containerSelectors ?? DEFAULT_CONTAINER_SELECTORS;
  const confirmSelectors = opts.confirmSelectors ?? DEFAULT_CONFIRM_SELECTORS;

  let containerEl: HTMLElement | null = null;
  let containerSel = '';
  for (const sel of containerSelectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) {
      containerEl = el;
      containerSel = sel;
      break;
    }
  }
  if (!containerEl) return { status: 'no-popup' };

  for (const sel of confirmSelectors) {
    const inContainer = containerEl.querySelector<HTMLElement>(sel);
    const candidate = inContainer ?? root.querySelector<HTMLElement>(sel);
    if (candidate && isVisible(candidate)) {
      candidate.click();
      return { status: 'confirmed', container: containerSel, confirm: sel };
    }
  }
  return { status: 'no-confirm-button', container: containerSel };
}
