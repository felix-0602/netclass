import { describe, expect, test, beforeEach, vi } from 'vitest';
import {
  findNextChapterButton,
  jumpNextChaoxingTask,
} from '../src/time-padder/chaoxing-task';

describe('findNextChapterButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('优先命中 #prevNextFocusNext', () => {
    document.body.innerHTML = `
      <a id="prevNextFocusNext" onclick="next()">下一节</a>
      <a class="nextChapter">下一节（旧版）</a>
    `;
    const found = findNextChapterButton(document);
    expect(found).not.toBeNull();
    expect(found!.selector).toBe('#prevNextFocusNext');
  });

  test('旧版 .nextChapter 能兜底', () => {
    document.body.innerHTML = '<a class="jb_btn jb_btn_92 fr fs14 nextChapter">下一节</a>';
    const found = findNextChapterButton(document);
    expect(found).not.toBeNull();
    expect(found!.selector).toContain('nextChapter');
  });

  test('hidden 按钮不算', () => {
    document.body.innerHTML = '<a id="prevNextFocusNext" style="display:none">结束</a>';
    const found = findNextChapterButton(document);
    expect(found).toBeNull();
  });

  test('完全没有按钮返回 null', () => {
    document.body.innerHTML = '<div>没东西</div>';
    expect(findNextChapterButton(document)).toBeNull();
  });
});

describe('jumpNextChaoxingTask', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  test('找到按钮后 settleDelay 后 click', async () => {
    const btn = document.createElement('a');
    btn.id = 'prevNextFocusNext';
    const clickSpy = vi.spyOn(btn, 'click');
    document.body.appendChild(btn);

    const promise = jumpNextChaoxingTask({ settleDelaySec: 2 });
    expect(clickSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;

    expect(result.status).toBe('jumped');
    if (result.status === 'jumped') {
      expect(result.buttonSelector).toBe('#prevNextFocusNext');
    }
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('没按钮返回 no_button', async () => {
    document.body.innerHTML = '<div>nothing</div>';
    const promise = jumpNextChaoxingTask({ settleDelaySec: 0 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result.status).toBe('no_button');
  });

  test('end marker 存在 → 返回 at_end', async () => {
    document.body.innerHTML = '<div class="endChapter">已是最后一章</div>';
    const promise = jumpNextChaoxingTask({ settleDelaySec: 0 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result.status).toBe('at_end');
  });
});
