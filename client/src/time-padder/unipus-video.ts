// U 校园音频/视频自动播放 — 对标 chaoxing-video.ts
//
// U 校园特点：
//   - 主要是 <audio> 元素（听力练习），偶尔有 <video>
//   - 音频 URL 在 CDN，hash 里含 duration（如 #duration=768.86）
//   - 有活跃度检测：鼠标/键盘无操作 → 暂停
//   - 需要播放完才能拿到"学习时长"积分
//
// 对策：
//   - 找所有 audio/video 元素 → muted + play
//   - 监听 ended 事件 → 触发回调（跳下一个练习）
//   - 定时模拟 mousemove（已在 unipus.ts boot 里启动）

export interface UnipusMediaOptions {
  /** 播放速率（默认 1.0，U 校园可能有速率检测，建议保持 1.0） */
  playbackRate?: number;
  /** 音频/视频播完后的回调 */
  onEnded?: () => void;
}

/**
 * 启动 U 校园音频/视频自动播放。
 * 返回清理函数，外部在路由切换时解绑。
 */
export function startUnipusMediaPadders(
  rootDoc: Document = document,
  opts: UnipusMediaOptions = {},
): () => void {
  const { playbackRate = 1.0, onEnded } = opts;

  const mediaElements = rootDoc.querySelectorAll<HTMLMediaElement>(
    'audio.unipus-audio-h5, video, audio',
  );

  const cleanups: Array<() => void> = [];

  mediaElements.forEach((media) => {
    // 跳过已处理过的
    if (media.dataset.unipusPadderApplied === '1') return;
    media.dataset.unipusPadderApplied = '1';

    media.muted = true;

    const onPlay = () => {
      media.playbackRate = playbackRate;
    };

    const onEndedHandler = () => {
      if (onEnded) onEnded();
    };

    media.addEventListener('play', onPlay);
    media.addEventListener('ended', onEndedHandler);

    // 启动播放
    const startPlay = () => {
      media.play().catch(() => {
        // 有些浏览器需要用户手势，重试一次
        setTimeout(() => media.play().catch(() => {}), 1000);
      });
    };

    // 如果已经可以播放，直接播；否则等 canplay
    if (media.readyState >= 2) {
      startPlay();
    } else {
      const onCanPlay = () => {
        startPlay();
        media.removeEventListener('canplay', onCanPlay);
      };
      media.addEventListener('canplay', onCanPlay);
    }

    cleanups.push(() => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('ended', onEndedHandler);
      media.pause();
      media.dataset.unipusPadderApplied = '0';
    });
  });

  return () => cleanups.forEach((fn) => fn());
}

/**
 * 尝试从 audio 元素的 src hash 中提取 duration。
 * U 校园 CDN URL 格式：...mp3#duration=768.867256&size=3603676&name=...
 */
export function extractDurationFromUrl(url: string): number | null {
  const m = url.match(/#duration=(\d+(?:\.\d+)?)/);
  if (m) return parseFloat(m[1]!);
  return null;
}

/**
 * 等待当前页面所有音频播完。
 * 返回 Promise，在最后一个音频 ended 时 resolve。
 */
export function waitForAllAudioEnded(rootDoc: Document = document): Promise<void> {
  const audios = rootDoc.querySelectorAll<HTMLAudioElement>('audio');
  if (audios.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let remaining = audios.length;
    const checkDone = () => {
      remaining--;
      if (remaining <= 0) resolve();
    };
    audios.forEach((a) => {
      if (a.ended || a.paused) {
        checkDone();
      } else {
        a.addEventListener('ended', checkDone, { once: true });
      }
    });
  });
}
