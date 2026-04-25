// chaoxing 弹窗 handler
//
// 触发场景（实测 2026-04 高数课 W3+++）：
//   - jumpNext 触发 #prevNextFocusNext 后，本章有未完成任务点 → 弹"任务点未完成，是否去完成？"
//   - 实测 popup 容器 = `.maskDiv.jobFinishTip` + 兄弟 `.popDiv.wid440.popMove`
//   - 内含按钮：上一节 (.preChapter) / 下一节 (.nextChapter) / 去学习 (.popMoveDele)
//   - 旧版 chaoxing 用 `.jb_dialog` 容器 — 仍兼容
//
// 安全保护：弹窗确认按钮 .nextChapter 跟页面正常 `<a class="...nextChapter">` 撞 selector
// （但跟 page 主按钮 `<div id="prevNextFocusNext">` 不会撞，因为 tag 不同）。
// 所以**先验容器可见**再点按钮，是核心防误触机制。

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
  // 实测高数课命中：mask 层 + dialog 层（chaoxing 同时渲染两层，任一可见即说明 popup 起来了）
  '.maskDiv.jobFinishTip',
  '#jobFinishTip',
  '.popDiv.popMove',
  // 旧版 chaoxing 兼容
  '.jb_dialog',
  '.layui-layer-dialog',
  '#chapterTaskDialog',
];

const DEFAULT_CONFIRM_SELECTORS = [
  // 实测：a.jb_btn.jb_btn_92.fr.fs14.nextChapter（高数课"任务点未完成"弹窗的"下一节"按钮）
  'a.jb_btn.jb_btn_92.fr.fs14.nextChapter',
  // 老的 jb_dialog 容器 + nextChapter（兼容旧版）
  '.jb_dialog .nextChapter',
  '.jb_dialog .jb_btn',
  // layui 风格
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
