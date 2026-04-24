// 反"切到后台 / 鼠标不在视频上"检测
//
// 调研结论（实测于 mooc1.chaoxing.com AIGC 课，2026-04-24）：
//   - 当前 chaoxing 视频播放器并不监听 visibilitychange / blur 来暂停
//   - "popFocus" 长时间未操作弹窗机制存在但被硬编码关掉（`if("0"!="1") return;`）
//   - 心跳 receiveStudyLog 仅带 ID 与 timestamp，无"用户活跃度"参数
//
// 但本模块仍构建 3 道前置防线，理由：
//   1. 别的课程 / 别的平台版本可能启用更严的检测（成本几乎 0）
//   2. Chrome 后台 tab 节流 setTimeout/setInterval 到 1Hz，会拖慢我们自己的逻辑
//   3. 反检测应有冗余，留余量给未来的反爬升级
//
// 每个同源 doc 跑一次。返回 cleanup 函数。

const BLOCKED_EVENTS = new Set(['visibilitychange', 'blur', 'pagehide']);

interface AntiBackgroundOptions {
  /** 合成 mousemove 的间隔，默认 30 秒 */
  mouseSyncIntervalMs?: number;
  /** 视频容器选择器，默认 `.video-js, video` */
  videoSelector?: string;
}

export function applyAntiBackground(
  targetDoc: Document = document,
  opts: AntiBackgroundOptions = {},
): () => void {
  const { mouseSyncIntervalMs = 30_000, videoSelector = '.video-js, video' } = opts;

  const win = targetDoc.defaultView;
  if (!win) return () => {};

  // ---- A. 重写 document.hidden / visibilityState ----
  // Document.prototype 上有原生 getter；这里在 instance 上 shadow 它。
  // 清理时 delete instance 属性即可恢复 prototype getter。
  const hiddenAlreadyOverridden =
    Object.getOwnPropertyDescriptor(targetDoc, 'hidden') !== undefined;
  let visibilityOverridden = false;
  if (!hiddenAlreadyOverridden) {
    try {
      Object.defineProperty(targetDoc, 'hidden', {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(targetDoc, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      visibilityOverridden = true;
    } catch {
      // 极少数环境（沙箱）禁止覆盖，吞掉错误继续别的防线
    }
  }

  // ---- B. 拦截 visibilitychange / blur / pagehide 的 addEventListener ----
  // 直接在 instance 上 shadow 方法。原方法走 EventTarget.prototype 调度，
  // 这样不依赖 instance.addEventListener 直接可达（happy-dom 上不可达）。
  const ETProto = (globalThis as { EventTarget?: typeof EventTarget }).EventTarget?.prototype;
  let listenersBlocked = false;
  if (ETProto && typeof ETProto.addEventListener === 'function') {
    const origAdd = ETProto.addEventListener;
    try {
      (targetDoc as unknown as Record<string, unknown>).addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (BLOCKED_EVENTS.has(type)) return;
        origAdd.call(targetDoc, type, listener, options);
      };
      (win as unknown as Record<string, unknown>).addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (BLOCKED_EVENTS.has(type)) return;
        origAdd.call(win, type, listener, options);
      };
      listenersBlocked = true;
    } catch {
      // ignore
    }
  }

  // ---- C. 周期合成 mousemove 在视频容器上 ----
  // 防"鼠标必须在视频上"的活跃度检测。坐标随机，避免被检测到周期性。
  const intervalId = win.setInterval(() => {
    const vid = targetDoc.querySelector<HTMLElement>(videoSelector);
    if (!vid) return;
    const r = vid.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    try {
      const evt = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX: r.left + Math.random() * r.width,
        clientY: r.top + Math.random() * r.height,
      });
      vid.dispatchEvent(evt);
    } catch {
      // 某些 jsdom-like 环境 MouseEvent 构造受限，吞掉
    }
  }, mouseSyncIntervalMs);

  // ---- cleanup ----
  return () => {
    win.clearInterval(intervalId);
    if (visibilityOverridden) {
      try {
        delete (targetDoc as unknown as Record<string, unknown>).hidden;
        delete (targetDoc as unknown as Record<string, unknown>).visibilityState;
      } catch {
        // ignore
      }
    }
    if (listenersBlocked) {
      try {
        delete (targetDoc as unknown as Record<string, unknown>).addEventListener;
        delete (win as unknown as Record<string, unknown>).addEventListener;
      } catch {
        // ignore
      }
    }
  };
}

/**
 * 在传入 doc 树（含同源 iframe）每一层都跑一遍 applyAntiBackground。
 * cleanup 一并返回。
 */
export function applyAntiBackgroundDeep(
  rootDoc: Document = document,
  opts: AntiBackgroundOptions = {},
): () => void {
  const cleanups: Array<() => void> = [];
  const visit = (d: Document): void => {
    cleanups.push(applyAntiBackground(d, opts));
    d.querySelectorAll('iframe').forEach((frame) => {
      try {
        const inner = (frame as HTMLIFrameElement).contentDocument;
        if (inner) visit(inner);
      } catch {
        // cross-origin
      }
    });
  };
  visit(rootDoc);
  return () => cleanups.forEach((fn) => fn());
}
