// 超星视频自动播放（刷时长核心）
// 实现参考：app.js:5343-5370 processMedia
//
// 核心观察（从原脚本 + 侦察得出）：
//   超星自己维护进度统计，基于 <video> 的 play/pause/ended 事件 + ananas 模块内部监听。
//   脚本不需要自己发心跳请求——只要**保持视频在播**，超星后端自然会累计时长。
//   我们要做的：
//     1. muted 播放（不打扰用户）
//     2. playbackRate 设置（默认 1.5x，加随机 jitter 反检测）
//     3. 监听 pause 事件 → 3 秒后自动恢复（覆盖用户误点）
//     4. 监听 ended 事件 → 通知外部，由 task 层跳下一任务点
//
// 关键合规点：不加速到超星未许可的倍速（2x 是平台上限，再高会被审计）

export interface VideoPadderOptions {
  /** 播放倍速，默认 1.5x；实际生效会加 ±0.1 jitter */
  playbackRate?: number;
  /** 静音播放（默认 true） */
  mute?: boolean;
  /** 视频结束时的回调（例如触发任务跳转） */
  onEnded?: (video: HTMLVideoElement) => void;
  /** 暂停后重播延迟（秒），默认 3，原脚本的实测值 */
  resumeDelaySec?: number;
}

/**
 * 控制一个 <video>（或 <audio>）节点：挂上 autoplay + resume + ended hooks。
 * 返回一个清理函数，用于解绑所有监听。
 */
export function attachVideoPadder(
  el: HTMLVideoElement | HTMLAudioElement,
  opts: VideoPadderOptions = {},
): () => void {
  const { playbackRate = 1.5, mute = true, onEnded, resumeDelaySec = 3 } = opts;

  if (mute) el.muted = true;

  // 反"整齐 1.5x" 特征：加 ±0.1 jitter
  const jittered = playbackRate + (Math.random() - 0.5) * 0.2;
  el.playbackRate = Math.min(2, Math.max(0.5, jittered));

  const tryPlay = (): void => {
    el.play().catch(() => {
      // 受 autoplay policy 拦截时，等用户首次点击页面触发
      const once = (): void => {
        void el.play();
        document.removeEventListener('click', once);
      };
      document.addEventListener('click', once, { once: true });
    });
  };

  // 3 秒内重复 pause → play（覆盖用户手滑 + 覆盖超星某些挂起逻辑）
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  const onPause = (): void => {
    if (el.ended) return; // 正常结束
    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => void el.play(), resumeDelaySec * 1000);
  };

  const onEndedInternal = (): void => {
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    // eslint-disable-next-line no-console
    console.info(
      `[netclass-sidekick/chaoxing-video] ${el.tagName.toLowerCase()} 播放完成，时长累计完成`,
    );
    onEnded?.(el as HTMLVideoElement);
  };

  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onEndedInternal);

  tryPlay();

  // 清理函数
  return () => {
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEndedInternal);
    if (pauseTimer) clearTimeout(pauseTimer);
  };
}

/**
 * 扫 document 里所有 <video> / <audio> 并挂上 padder。
 * 返回清理函数，解绑所有挂载。
 */
export function startChaoxingMediaPadders(
  doc: Document = document,
  opts: VideoPadderOptions = {},
): () => void {
  const elements = doc.querySelectorAll<HTMLVideoElement | HTMLAudioElement>('video, audio');
  const cleanups: Array<() => void> = [];
  elements.forEach((el) => {
    cleanups.push(attachVideoPadder(el, opts));
  });
  return () => cleanups.forEach((fn) => fn());
}

/**
 * 旧接口保留：Phase 0 Week 1 规划里的 startChaoxingVideoPadder()
 * 使用默认选项，扫主 document。
 */
export function startChaoxingVideoPadder(opts: VideoPadderOptions = {}): () => void {
  return startChaoxingMediaPadders(document, opts);
}
