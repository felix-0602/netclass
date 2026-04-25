// URL 变化监听
//
// 对应旧 app.js:5309-5316 的 setupInterceptor：每 2 秒 poll window.location.href，
// 变了就重跑 iframe 分派。超星是 SPA，切章节不 reload 页面。
//
// 这里用 pure-function 设计方便单测：传入 getUrl + onChange，返回 cleanup。

export interface UrlWatcherOptions {
  intervalMs?: number;
  getUrl?: () => string;
}

export function watchUrl(onChange: (url: string, prev: string) => void, opts: UrlWatcherOptions = {}): () => void {
  const { intervalMs = 2000, getUrl = () => window.location.href } = opts;
  let last = getUrl();
  const id = setInterval(() => {
    const now = getUrl();
    if (now !== last) {
      const prev = last;
      last = now;
      try {
        onChange(now, prev);
      } catch (e) {
        console.warn('[netclass-sidekick/url-watcher] onChange threw:', e);
      }
    }
  }, intervalMs);
  return () => clearInterval(id);
}

export interface InnerIframeWatcherOptions {
  intervalMs?: number;
  /** iframe selector — 默认所有 iframe */
  iframeSelector?: string;
  rootDoc?: Document;
}

export interface InnerIframeChange {
  iframe: HTMLIFrameElement;
  src: string;
  prevSrc: string;
}

/**
 * 监听内层 iframe src 变化（chaoxing cards iframe 的 num= 切换）。
 *
 * 跟顶层 watchUrl 互补 — chaoxing 部分场景（点章节树里子节、cards iframe num= 翻页）
 * 只改 iframe src 不改 top URL，光监听 location.href 会漏掉。
 *
 * 用 setInterval 轮询 iframe[src]，跟现有 watchUrl 风格一致；
 * 不用 MutationObserver 因为 chaoxing 偶尔通过 contentWindow.location.replace 切 iframe，
 * 不一定触发 attribute mutation。
 */
export function watchInnerIframeUrls(
  onChange: (info: InnerIframeChange) => void,
  opts: InnerIframeWatcherOptions = {},
): () => void {
  const {
    intervalMs = 2000,
    iframeSelector = 'iframe',
    rootDoc = document,
  } = opts;

  // 每个 iframe 元素记一份 last src
  const seen = new WeakMap<HTMLIFrameElement, string>();

  const id = setInterval(() => {
    const iframes = rootDoc.querySelectorAll<HTMLIFrameElement>(iframeSelector);
    iframes.forEach((f) => {
      const cur = f.src || '';
      const prev = seen.get(f);
      if (prev === undefined) {
        seen.set(f, cur);
        return;
      }
      if (cur !== prev) {
        seen.set(f, cur);
        try {
          onChange({ iframe: f, src: cur, prevSrc: prev });
        } catch (e) {
          console.warn('[netclass-sidekick/url-watcher] inner onChange threw:', e);
        }
      }
    });
  }, intervalMs);
  return () => clearInterval(id);
}
