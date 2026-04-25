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

  test('W3+++: cards iframe src 改了（章内切节）→ 不触发 popup detect', async () => {
    // 模拟 chaoxing 章内切节：点击改 cards iframe num=，top URL 不变
    document.body.innerHTML = `
      <a id="prevNextFocusNext">下一节</a>
      <iframe id="cards" src="https://mooc1.chaoxing.com/cards?num=0"></iframe>
      <!-- popup 容器但 hidden — 若 W3+++ 误以为没跳，会去找 popup -->
      <div class="maskDiv jobFinishTip" style="display:none">
        <a class="jb_btn jb_btn_92 fr fs14 nextChapter">下一节</a>
      </div>
    `;
    const btn = document.getElementById('prevNextFocusNext')!;
    const cards = document.getElementById('cards') as HTMLIFrameElement;
    const popupBtn = document.querySelector<HTMLAnchorElement>('a.nextChapter')!;
    const popupSpy = vi.spyOn(popupBtn, 'click');

    // click 时改 cards iframe src（模拟 chaoxing PCount.next 逻辑）
    btn.addEventListener('click', () => {
      cards.src = 'https://mooc1.chaoxing.com/cards?num=3';
    });

    const promise = jumpNextChaoxingTask({ settleDelaySec: 0, popupRetryMs: 200 });
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.status).toBe('jumped');
    if (result.status === 'jumped') {
      // 应只命中主按钮 selector，不带 popup 后缀
      expect(result.buttonSelector).toBe('#prevNextFocusNext');
    }
    // popup 按钮不应被点 — 因为 cards iframe src 变化已说明跳成功
    expect(popupSpy).not.toHaveBeenCalled();
  });
});
