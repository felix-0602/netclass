// iframe 内容分派
//
// 对应旧 app.js:5434-5469 的 processIframe：按 iframe.src 关键字决定处理流。
// 超星的 iframe 种类有限：
//   - api/work  → 作业/测验题目
//   - video     → 视频播放器
//   - audio     → 音频
//   - modules/ppt|doc|pdf → 文档阅读
//   - modules/innerbook   → 电子书
//

import { sleep } from '../lib/sleep';
// 本模块只做**识别**，不做处理逻辑 —— 处理交给调用方（adapter/filler）。
//
// 用法：
//   const dispatcher = createIframeDispatcher({
//     onWork: (iframe) => runFiller(iframe.contentDocument!),
//     onVideo: (iframe) => startVideoPadder(iframe.contentDocument!),
//     ...
//   });
//   dispatcher.scanAll(document);

export type IframeKind = 'work' | 'video' | 'audio' | 'document-reader' | 'ebook' | 'ignored' | 'finished';

export interface IframeMetadata {
  iframe: HTMLIFrameElement;
  kind: IframeKind;
  src: string;
  /** 父元素 class 上是否有"已完成"标记 */
  finished: boolean;
}

export function classifyIframe(iframe: HTMLIFrameElement): IframeMetadata {
  const src = iframe.src || '';
  const parentClass = iframe.parentElement?.className ?? '';
  const finished = parentClass.includes('ans-job-finished');

  let kind: IframeKind = 'ignored';
  if (finished) {
    kind = 'finished';
  } else if (src.includes('javascript:')) {
    kind = 'ignored';
  } else if (src.includes('/api/work') || src.includes('/mooc-ans/api/work') || src.includes('modules/work/')) {
    kind = 'work';
  } else if (src.includes('modules/video') || /\bvideo\b/.test(src)) {
    // 实测高数课 1.1：iframe id="mindmap" 也用 modules/video/index.html 作为壳，
    // 但其实是脑图控件不是真视频。被误判会让 course-runner 进 video-pending 死等。
    // 同理 .min_map_iframe 父容器也是非视频壳。
    if (iframe.id === 'mindmap' || parentClass.includes('min_map_iframe')) {
      kind = 'ignored';
    } else {
      kind = 'video';
    }
  } else if (src.includes('modules/audio') || /\baudio\b/.test(src)) {
    kind = 'audio';
  } else if (/modules\/(ppt|pptx|doc|docx|pdf)/.test(src)) {
    kind = 'document-reader';
  } else if (src.includes('modules/innerbook')) {
    kind = 'ebook';
  }
  return { iframe, kind, src, finished };
}

/**
 * 递归收集同源 iframe，按种类分类返回。
 * 跨域 iframe 直接跳过（contentDocument 访问会抛）。
 */
export function scanIframes(rootDoc: Document): IframeMetadata[] {
  const out: IframeMetadata[] = [];
  const visit = (doc: Document): void => {
    doc.querySelectorAll('iframe').forEach((f) => {
      const meta = classifyIframe(f as HTMLIFrameElement);
      out.push(meta);
      try {
        const inner = (f as HTMLIFrameElement).contentDocument;
        if (inner) visit(inner);
      } catch {
        // cross-origin
      }
    });
  };
  visit(rootDoc);
  return out;
}

/**
 * 解析 work iframe 的真实 contentDocument。
 *
 * 实测 2026-05 高数：work 壳 iframe（/ananas/modules/work/index.html）内层 api/work
 * iframe 由 JS 动态创建，网速慢时 scanIframes 跑完它还没出现。
 * 本函数自动识别 work 壳 vs 内层 api/work，等内层加载完毕再返回 doc。
 *
 * @returns 包含 .TiMu 的 document，或 null（超时/跨域）
 */
export async function resolveWorkDoc(
  workFrame: HTMLIFrameElement,
  timeoutMs = 15000,
): Promise<Document | null> {
  const src = workFrame.src || '';

  // 直接是 api/work iframe — 等 .TiMu 出现
  if (src.includes('/api/work') || src.includes('/mooc-ans/api/work')) {
    return waitForTiMu(workFrame, timeoutMs);
  }

  // work 壳 iframe（/ananas/modules/work/）— 等内层 api/work iframe 出现
  if (src.includes('modules/work/')) {
    const innerDoc = await waitForInnerWorkFrame(workFrame, timeoutMs);
    if (!innerDoc) return null;
    return waitForTiMuInDoc(innerDoc, timeoutMs);
  }

  // fallback：直接在当前 doc 里等 .TiMu
  try {
    const doc = workFrame.contentDocument;
    return doc ? await waitForTiMuInDoc(doc, timeoutMs) : null;
  } catch {
    return null;
  }
}

async function waitForInnerWorkFrame(
  shellFrame: HTMLIFrameElement,
  timeoutMs: number,
): Promise<Document | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const shellDoc = shellFrame.contentDocument;
      if (!shellDoc) { await sleep(300); continue; }
      const inner = shellDoc.querySelector<HTMLIFrameElement>(
        'iframe[src*="/api/work"], iframe[src*="/mooc-ans/api/work"]',
      );
      if (inner) {
        try { return inner.contentDocument; } catch { /* cross-origin */ }
      }
    } catch { /* cross-origin */ }
    await sleep(300);
  }
  return null;
}

async function waitForTiMu(
  frame: HTMLIFrameElement,
  timeoutMs: number,
): Promise<Document | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.querySelector('.TiMu')) return doc;
    } catch { return null; }
    await sleep(200);
  }
  return null;
}

async function waitForTiMuInDoc(
  doc: Document,
  timeoutMs: number,
): Promise<Document | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (doc.querySelector('.TiMu')) return doc;
    await sleep(200);
  }
  return doc; // 超时也返回 doc，让调用方拿到后能报 "0 题" 而非 crash
}



export interface IframeHandlers {
  onWork?: (meta: IframeMetadata) => void | Promise<void>;
  onVideo?: (meta: IframeMetadata) => void | Promise<void>;
  onAudio?: (meta: IframeMetadata) => void | Promise<void>;
  onDocumentReader?: (meta: IframeMetadata) => void | Promise<void>;
  onEbook?: (meta: IframeMetadata) => void | Promise<void>;
  onFinished?: (meta: IframeMetadata) => void | Promise<void>;
}

/**
 * 扫描 + 串行派发。
 * 串行（不并发）是因为旧版经验：多个 iframe 同时跑容易触发 chaoxing 反爬节流。
 */
export async function dispatchIframes(rootDoc: Document, handlers: IframeHandlers): Promise<void> {
  const metas = scanIframes(rootDoc);
  for (const meta of metas) {
    try {
      switch (meta.kind) {
        case 'work':
          await handlers.onWork?.(meta);
          break;
        case 'video':
          await handlers.onVideo?.(meta);
          break;
        case 'audio':
          await handlers.onAudio?.(meta);
          break;
        case 'document-reader':
          await handlers.onDocumentReader?.(meta);
          break;
        case 'ebook':
          await handlers.onEbook?.(meta);
          break;
        case 'finished':
          await handlers.onFinished?.(meta);
          break;
        case 'ignored':
        default:
          break;
      }
    } catch (e) {
      console.warn('[netclass-sidekick/iframe-dispatch]', meta.kind, 'handler threw:', e);
    }
  }
}
