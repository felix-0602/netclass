export interface VideoPadderOptions {
  playbackRate?: number;
  mute?: boolean;
  onEnded?: (video: HTMLVideoElement) => void;
  resumeDelaySec?: number;
  respectUserPause?: boolean;
}

export function attachVideoPadder(
  el: HTMLVideoElement | HTMLAudioElement,
  opts: VideoPadderOptions = {},
): () => void {
  const {
    playbackRate = 1.5,
    mute = true,
    onEnded,
    resumeDelaySec = 3,
    respectUserPause = true,
  } = opts;

  if (mute) el.muted = true;

  const jittered = playbackRate + (Math.random() - 0.5) * 0.2;
  el.playbackRate = Math.min(2, Math.max(0.5, jittered));

  const tryPlay = (): void => {
    el.play().catch(() => {
      const once = (): void => {
        void el.play();
        document.removeEventListener('click', once);
      };
      document.addEventListener('click', once, { once: true });
    });
  };

  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlayAt = 0;

  const onPlay = (): void => {
    lastPlayAt = Date.now();
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
  };

  const onPause = (): void => {
    if (el.ended) return;
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    if (respectUserPause && lastPlayAt > 0 && Date.now() - lastPlayAt >= 500) {
      return;
    }
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      void el.play();
    }, resumeDelaySec * 1000);
  };

  const onEndedInternal = (): void => {
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    onEnded?.(el as HTMLVideoElement);
  };

  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('ended', onEndedInternal);

  tryPlay();

  return () => {
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('ended', onEndedInternal);
    if (pauseTimer) clearTimeout(pauseTimer);
  };
}

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

export function startChaoxingVideoPadder(opts: VideoPadderOptions = {}): () => void {
  return startChaoxingMediaPadders(document, opts);
}
