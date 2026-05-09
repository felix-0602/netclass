// 非答题类任务点 handler 集合 —— 对齐旧 app.js:5343-5421 的 process* 系列
//
// 涵盖：
//   - processMedia（视频/音频）—— 已由 time-padder/chaoxing-video.ts 处理
//   - processPpt    —— 翻 #panView 内 iframe 到底
//   - processBook   —— 调 _unsafeWindow.top.onchangepage 翻完整本
//   - processWork   —— 走 filler，由 main.ts 直接 wire
//
// 所有 handler 是**幂等**的：完成态再调一次也不会出错（用于"扫一遍 + 跳下一节"循环里）。

import { sleep } from '../lib/sleep';

/**
 * PPT/PDF/DOC reader：滚到底 = 标记已读
 *
 * chaoxing 的 PPT 容器有多种结构，按优先级尝试：
 *   1. #panView 里的内层 iframe（老版本 .ppt）
 *   2. .ans-attach-ct insertdoc 模块的 iframe（新版 .pptx 实测命中）
 *   3. iframe 自身 document（兜底 — 内容直接渲染在 iframe 根 doc 里）
 */
export async function processPptReader(iframe: HTMLIFrameElement): Promise<{ ok: boolean; reason?: string }> {
  const ifWin = iframe.contentWindow;
  const ifDoc = iframe.contentDocument;
  if (!ifWin || !ifDoc) return { ok: false, reason: 'no contentWindow/Document' };

  type ScrollTarget = { desc: string; win: Window; doc: Document };

  const candidates: Array<() => ScrollTarget | null> = [
    () => {
      const f = ifDoc.querySelector<HTMLIFrameElement>('#panView');
      if (!f?.contentWindow || !f.contentDocument) return null;
      return { desc: '#panView 内层 iframe', win: f.contentWindow, doc: f.contentDocument };
    },
    () => {
      const wrap = ifDoc.querySelector('.ans-attach-ct');
      const inner = wrap?.querySelector<HTMLIFrameElement>('iframe');
      if (!inner?.contentWindow || !inner.contentDocument) return null;
      return { desc: '.ans-attach-ct insertdoc iframe', win: inner.contentWindow, doc: inner.contentDocument };
    },
    () => ({ desc: 'iframe 自身 document', win: ifWin, doc: ifDoc }),
  ];

  let lastErr: string | undefined;
  for (const find of candidates) {
    const t = find();
    if (!t) continue;
    try {
      const h = t.doc.body.scrollHeight;
      t.win.scrollTo({ top: h, behavior: 'smooth' });
      // chaoxing 监听 scroll 事件计完成度，给 0.5s 滚到底
      await sleep(500);
      // 再硬拉一次防 smooth 滚不到
      t.win.scrollTo(0, h);
      // 部分 .pptx 用 IntersectionObserver/scroll 计完成 — 主动派发一次
      try {
        t.win.dispatchEvent(new Event('scroll'));
      } catch {
        // ignore
      }
      return { ok: true, reason: t.desc };
    } catch (e) {
      lastErr = `${t.desc}: ${(e as Error).message}`;
    }
  }
  return { ok: false, reason: lastErr ?? 'all scroll targets failed' };
}

/** 电子书：调 chaoxing 暴露的 onchangepage(end) 翻到末页 */
export async function processBook(iframe: HTMLIFrameElement): Promise<{ ok: boolean; reason?: string }> {
  const ifWin = iframe.contentWindow as
    | (Window & {
        getFrameAttr?: (k: string) => string | number;
      })
    | null;
  if (!ifWin) return { ok: false, reason: 'no contentWindow' };

  // _unsafeWindow.top 是 Tampermonkey 暴露的真 top window；getElementById 也行但脆
  // app.js:5419 用 _unsafeWindow.top.onchangepage(...)
  const topWin = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).top as
    | (Window & { onchangepage?: (page: number | string) => void })
    | null;
  if (!topWin || typeof topWin.onchangepage !== 'function') {
    return { ok: false, reason: 'top.onchangepage 不可用' };
  }

  try {
    const endPage = ifWin.getFrameAttr?.('end');
    if (endPage == null) return { ok: false, reason: 'getFrameAttr("end") 返回 null' };
    topWin.onchangepage(endPage);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** 已完成任务点：no-op */
export function processFinished(): { ok: boolean } {
  return { ok: true };
}


