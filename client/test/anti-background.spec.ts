import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyAntiBackground } from '../src/runtime/anti-background';

describe('applyAntiBackground', () => {
  let cleanups: Array<() => void> = [];

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    cleanups = [];
  });

  test('A. document.hidden 被永久重写为 false', () => {
    const cleanup = applyAntiBackground(document);
    cleanups.push(cleanup);
    expect(document.hidden).toBe(false);
    expect(document.visibilityState).toBe('visible');
  });

  test('A. cleanup 后 document.hidden 恢复原 getter（happy-dom 默认 false）', () => {
    const before = document.hidden;
    const cleanup = applyAntiBackground(document);
    cleanup();
    // happy-dom 原生 hidden 是 false，所以读出来仍是 false，但属性描述符应已被删除
    const desc = Object.getOwnPropertyDescriptor(document, 'hidden');
    expect(desc).toBeUndefined();
    expect(document.hidden).toBe(before);
  });

  test('B. visibilitychange / blur / pagehide 的 addEventListener 被吞掉', () => {
    const handler = vi.fn();
    cleanups.push(applyAntiBackground(document));

    document.addEventListener('visibilitychange', handler);
    document.addEventListener('blur', handler);
    document.addEventListener('pagehide', handler);

    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('pagehide'));

    expect(handler).not.toHaveBeenCalled();
  });

  test('B. 其他事件名照常注册并触发', () => {
    const handler = vi.fn();
    cleanups.push(applyAntiBackground(document));

    document.addEventListener('click', handler);
    document.dispatchEvent(new Event('click'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('B. window 上的 visibilitychange / blur 也被拦', () => {
    const handler = vi.fn();
    cleanups.push(applyAntiBackground(document));

    window.addEventListener('blur', handler);
    window.dispatchEvent(new Event('blur'));

    expect(handler).not.toHaveBeenCalled();
  });

  test('C. 周期合成 mousemove 在视频容器上', () => {
    vi.useFakeTimers();
    try {
      // 准备一个假视频容器
      const vid = document.createElement('div');
      vid.className = 'video-js';
      // happy-dom 不会自动布局，手工塞 getBoundingClientRect
      Object.defineProperty(vid, 'getBoundingClientRect', {
        value: () => ({
          left: 100,
          top: 100,
          width: 640,
          height: 360,
          right: 740,
          bottom: 460,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        }),
      });
      document.body.appendChild(vid);

      const onMouseMove = vi.fn();
      // 注意：mousemove 不在被拦截列表里，所以 listener 能注册
      vid.addEventListener('mousemove', onMouseMove);

      cleanups.push(applyAntiBackground(document, { mouseSyncIntervalMs: 5_000 }));

      // 默认间隔 5s 后触发一次
      vi.advanceTimersByTime(5_000);
      expect(onMouseMove).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5_000);
      expect(onMouseMove).toHaveBeenCalledTimes(2);

      vid.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  test('C. 没有视频容器时不报错', () => {
    vi.useFakeTimers();
    try {
      cleanups.push(applyAntiBackground(document, { mouseSyncIntervalMs: 1_000 }));
      expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  test('cleanup 后 interval 不再触发', () => {
    vi.useFakeTimers();
    try {
      const vid = document.createElement('div');
      vid.className = 'video-js';
      Object.defineProperty(vid, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }),
      });
      document.body.appendChild(vid);

      const onMouseMove = vi.fn();
      vid.addEventListener('mousemove', onMouseMove);

      const cleanup = applyAntiBackground(document, { mouseSyncIntervalMs: 1_000 });
      vi.advanceTimersByTime(1_000);
      expect(onMouseMove).toHaveBeenCalledTimes(1);

      cleanup();
      vi.advanceTimersByTime(5_000);
      expect(onMouseMove).toHaveBeenCalledTimes(1); // 没再涨

      vid.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  test('在已被覆写过的 doc 上重复调用不会重复 shadow', () => {
    const cleanup1 = applyAntiBackground(document);
    cleanups.push(cleanup1);
    expect(document.hidden).toBe(false);

    // 再调一次：因为 instance 已有 hidden 描述符，第二次跳过覆写
    const cleanup2 = applyAntiBackground(document);
    cleanups.push(cleanup2);
    expect(document.hidden).toBe(false);
  });
});
