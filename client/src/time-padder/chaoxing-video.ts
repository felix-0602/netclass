export interface VideoPadderOptions {
  playbackRate?: number;
  mute?: boolean;
  onEnded?: (video: HTMLVideoElement | HTMLAudioElement) => void;
  subscriptionKey?: string;
  resumeDelaySec?: number;
  respectUserPause?: boolean;
}

interface AttachedMedia {
  cleanup: () => void;
  endedHandlers: Set<NonNullable<VideoPadderOptions['onEnded']>>;
  keyedEndedHandlers: Map<
    string,
    { handler: NonNullable<VideoPadderOptions['onEnded']>; token: object }
  >;
  refs: number;
}

const ATTACHED_MEDIA = new WeakMap<HTMLVideoElement | HTMLAudioElement, AttachedMedia>();

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
    onEnded?.(el);
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
    let attached = ATTACHED_MEDIA.get(el);
    if (!attached) {
      const endedHandlers = new Set<NonNullable<VideoPadderOptions['onEnded']>>();
      const cleanup = attachVideoPadder(el, {
        ...opts,
        onEnded: (media) => {
          endedHandlers.forEach((handler) => handler(media));
          attached?.keyedEndedHandlers.forEach(({ handler }) => handler(media));
        },
      });
      attached = { cleanup, endedHandlers, keyedEndedHandlers: new Map(), refs: 0 };
      ATTACHED_MEDIA.set(el, attached);
    }

    const onEnded = opts.onEnded;
    const subscriptionKey = opts.subscriptionKey;
    const token = {};
    if (onEnded) {
      if (subscriptionKey) {
        if (!attached.keyedEndedHandlers.has(subscriptionKey)) {
          attached.refs++;
        }
        attached.keyedEndedHandlers.set(subscriptionKey, { handler: onEnded, token });
      } else {
        attached.endedHandlers.add(onEnded);
        attached.refs++;
      }
    }

    const wrapped = () => {
      let removedRef = false;
      if (subscriptionKey) {
        const registered = attached.keyedEndedHandlers.get(subscriptionKey);
        if (registered?.token === token) {
          attached.keyedEndedHandlers.delete(subscriptionKey);
          removedRef = true;
        }
      } else if (onEnded) {
        attached.endedHandlers.delete(onEnded);
        removedRef = true;
      }
      if (removedRef) attached.refs--;
      if (attached.refs === 0) {
        attached.cleanup();
        ATTACHED_MEDIA.delete(el);
      }
    };
    cleanups.push(wrapped);
  });
  return () => cleanups.forEach((fn) => fn());
}

export function startChaoxingVideoPadder(opts: VideoPadderOptions = {}): () => void {
  return startChaoxingMediaPadders(document, opts);
}
