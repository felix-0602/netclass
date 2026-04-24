import { describe, expect, test, beforeEach, vi } from 'vitest';
import { attachVideoPadder } from '../src/time-padder/chaoxing-video';

/**
 * happy-dom 的 HTMLVideoElement 没有真实 play/pause 动作，但事件派发仍可工作。
 * 我们通过 stub play/pause + 手动 dispatchEvent 来测行为。
 */

function makeStubbedVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  // stub play：记录被调次数
  (v as any).play = vi.fn().mockResolvedValue(undefined);
  return v;
}

describe('attachVideoPadder', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  test('挂载后会设置 muted + playbackRate + 自动 play', () => {
    const v = makeStubbedVideo();
    document.body.appendChild(v);

    attachVideoPadder(v);

    expect(v.muted).toBe(true);
    expect(v.playbackRate).toBeGreaterThanOrEqual(0.5);
    expect(v.playbackRate).toBeLessThanOrEqual(2);
    expect((v.play as any)).toHaveBeenCalled();
  });

  test('mute: false 保持不静音', () => {
    const v = makeStubbedVideo();
    document.body.appendChild(v);

    attachVideoPadder(v, { mute: false });
    expect(v.muted).toBe(false);
  });

  test('pause 后延时 3 秒自动恢复播放', () => {
    const v = makeStubbedVideo();
    document.body.appendChild(v);

    attachVideoPadder(v, { resumeDelaySec: 3 });

    // 清除启动时的 play 调用记录
    (v.play as any).mockClear();

    v.dispatchEvent(new Event('pause'));
    expect((v.play as any)).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3001);
    expect((v.play as any)).toHaveBeenCalled();
  });

  test('ended 触发 onEnded 回调且不再触发 resume', () => {
    const v = makeStubbedVideo();
    document.body.appendChild(v);
    const onEnded = vi.fn();

    attachVideoPadder(v, { onEnded, resumeDelaySec: 3 });
    (v.play as any).mockClear();

    v.dispatchEvent(new Event('ended'));
    vi.advanceTimersByTime(5000);

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect((v.play as any)).not.toHaveBeenCalled();
  });

  test('cleanup 函数能解绑 pause 监听', () => {
    const v = makeStubbedVideo();
    document.body.appendChild(v);

    const cleanup = attachVideoPadder(v);
    (v.play as any).mockClear();

    cleanup();

    v.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(5000);

    // cleanup 后不应再触发 play
    expect((v.play as any)).not.toHaveBeenCalled();
  });
});
