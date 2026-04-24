// 非答题类任务点 handler 集合 —— 对齐旧 app.js:5343-5421 的 process* 系列
//
// 涵盖：
//   - processMedia（视频/音频）—— 已由 time-padder/chaoxing-video.ts 处理
//   - processPpt    —— 翻 #panView 内 iframe 到底
//   - processBook   —— 调 _unsafeWindow.top.onchangepage 翻完整本
//   - processWork   —— 走 filler，由 main.ts 直接 wire
//
// 所有 handler 是**幂等**的：完成态再调一次也不会出错（用于"扫一遍 + 跳下一节"循环里）。

/** PPT/PDF/DOC reader：滚 #panView 子 iframe 到底 = 标记已读 */
export async function processPptReader(iframe: HTMLIFrameElement): Promise<{ ok: boolean; reason?: string }> {
  const ifWin = iframe.contentWindow;
  const ifDoc = iframe.contentDocument;
  if (!ifWin || !ifDoc) return { ok: false, reason: 'no contentWindow/Document' };

  // chaoxing PPT 把内容嵌在 #panView 里另一层 iframe
  const panView = ifDoc.querySelector<HTMLIFrameElement>('#panView');
  const target = panView?.contentWindow ?? ifWin;
  const targetDoc = panView?.contentDocument ?? ifDoc;

  try {
    target.scrollTo({
      top: targetDoc.body.scrollHeight,
      behavior: 'smooth',
    });
    // 给浏览器 0.5s 滚到底（chaoxing 监听滚动事件计完成度）
    await sleep(500);
    // 再硬拉一次到底，防 smooth 滚不到
    target.scrollTo(0, targetDoc.body.scrollHeight);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
