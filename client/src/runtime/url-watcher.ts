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
