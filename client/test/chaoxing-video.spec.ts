import { beforeEach, describe, expect, test, vi } from 'vitest';
import { attachVideoPadder } from '../src/time-padder/chaoxing-video';

function makeStubbedVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  return video;
}

describe('attachVideoPadder', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  test('sets muted, playbackRate, and autoplay on attach', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    attachVideoPadder(video);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBeGreaterThanOrEqual(0.5);
    expect(video.playbackRate).toBeLessThanOrEqual(2);
    expect(video.play).toHaveBeenCalled();
  });

  test('keeps audio on when mute is false', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    attachVideoPadder(video, { mute: false });

    expect(video.muted).toBe(false);
  });

  test('resumes after a short pause jitter', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    attachVideoPadder(video, { resumeDelaySec: 3 });
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('pause'));
    expect(video.play).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3001);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  test('does not resume after a user pause', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    attachVideoPadder(video, { resumeDelaySec: 3 });
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(501);
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(3001);

    expect(video.play).not.toHaveBeenCalled();
  });

  test('does not resume when autoplay jitter is followed by play', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    attachVideoPadder(video, { resumeDelaySec: 3 });
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(3001);

    expect(video.play).not.toHaveBeenCalled();
  });

  test('calls onEnded and does not resume after ended', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);
    const onEnded = vi.fn();

    attachVideoPadder(video, { onEnded, resumeDelaySec: 3 });
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    video.dispatchEvent(new Event('ended'));
    vi.advanceTimersByTime(5000);

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(video.play).not.toHaveBeenCalled();
  });

  test('cleanup removes the pause listener', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);

    const cleanup = attachVideoPadder(video);
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    cleanup();
    video.dispatchEvent(new Event('pause'));
    vi.advanceTimersByTime(5000);

    expect(video.play).not.toHaveBeenCalled();
  });

  test('cleanup removes the play listener', () => {
    const video = makeStubbedVideo();
    document.body.appendChild(video);
    const removeEventListenerSpy = vi.spyOn(video, 'removeEventListener');

    const cleanup = attachVideoPadder(video);
    cleanup();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('play', expect.any(Function));
  });
});
