// 超星任务点自动跳转
// 参考 app.js:5318-5342 watchIframe 尾部的"下一章节" 逻辑

import { detectAndConfirmPopup } from '../runtime/popup-handler';
import { sleep } from '../lib/sleep';

export interface JumpNextOptions {
  /** 跳转前等待秒数，让超星自己的统计请求收尾 */
  settleDelaySec?: number;
  /** 搜寻按钮的 root document（支持跨 iframe 时传入） */
  root?: Document;
  /**
   * 点击后等多少 ms 看 URL 是否变；若没变 + 弹窗出现 → 自动点确认。
   * 0 = 关闭（默认，保持向后兼容）。course-runner 默认传 1500。
   */
  popupRetryMs?: number;
}

export type JumpResult =
  | { status: 'jumped'; buttonSelector: string }
  | { status: 'at_end'; reason: string }
  | { status: 'no_button' };

// 按优先级排列的"下一章节" 按钮选择器。
// #prevNextFocusNext 是新版 UI，.nextChapter 是旧版兜底。
const NEXT_BUTTON_SELECTORS = [
  '#prevNextFocusNext',
  '.jb_btn.jb_btn_92.fr.fs14.nextChapter',
  '.nextChapter',
  'a[onclick*="nextChapter"]',
];

function isVisible(el: HTMLElement): boolean {
  // 显式 inline style 隐藏 → 不算
  if (el.style.display === 'none' || el.style.visibility === 'hidden') {
    return false;
  }
  // 浏览器环境下用 computed style 二次确认（happy-dom 里可能无效，所以放弃 offsetParent 检查）
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    } catch {
      // getComputedStyle 在某些 happy-dom 场景会抛，忽略
    }
  }
  return true;
}

/**
 * 在给定 document 中找可点击的"下一章节" 按钮。
 * 返回按钮引用 + 命中的 selector；找不到返回 null。
 */
export function findNextChapterButton(
  root: Document = document,
): { el: HTMLElement; selector: string } | null {
  for (const sel of NEXT_BUTTON_SELECTORS) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) {
      return { el, selector: sel };
    }
  }
  return null;
}

/**
 * 视频/音频播完（或整页任务点完成）后调用。
 * 等 `settleDelaySec` 秒让超星自己的统计收尾，再点下一章节按钮。
 *
 * 返回 Promise<JumpResult>，让调用方记录结果或打日志。
 */
export async function jumpNextChaoxingTask(
  opts: JumpNextOptions = {},
): Promise<JumpResult> {
  const { settleDelaySec = 3, root = document, popupRetryMs = 0 } = opts;

  await sleep(settleDelaySec * 1000);

  const found = findNextChapterButton(root);
  if (!found) {
    // 无按钮可能是：1) 已到最后一章 2) 页面结构变了
    const endMarker = root.querySelector<HTMLElement>('.endChapter, #prevNextFocusNext[style*="display: none"]');
    if (endMarker) {
      return { status: 'at_end', reason: 'end_of_course_marker_detected' };
    }
    return { status: 'no_button' };
  }

  // 记 click 前的状态：top URL + 所有 iframe.src（chaoxing 章内切节只动 cards iframe src，
  // top URL 不变 — 实测 W3+++ 高数课 1.1 num=0→3 正是这种）
  const ownerWin = root.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const urlBefore = ownerWin?.location?.href;
  const iframesBefore = snapshotIframeSrcs(root);

  found.el.click();

  // popupRetryMs > 0 时检查弹窗（course-runner 用，单测保持快）
  if (popupRetryMs > 0 && ownerWin) {
    await sleep(popupRetryMs);
    const urlAfter = ownerWin.location?.href;
    const iframesAfter = snapshotIframeSrcs(root);
    const navigationHappened =
      urlAfter !== urlBefore || !sameIframeSrcs(iframesBefore, iframesAfter);
    if (!navigationHappened) {
      // 真没跳 — 大概率被 popup 拦了
      const popup = detectAndConfirmPopup(root);
      if (popup.status === 'confirmed') {
        return {
          status: 'jumped',
          buttonSelector: `${found.selector} + popup:${popup.confirm}`,
        };
      }
    }
  }

  return { status: 'jumped', buttonSelector: found.selector };
}

function snapshotIframeSrcs(root: Document): string[] {
  return Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe')).map((f) => f.src || '');
}

function sameIframeSrcs(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}


