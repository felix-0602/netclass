import { beforeEach, describe, expect, test, vi } from 'vitest';
import { detectAndConfirmPopup } from '../src/runtime/popup-handler';

describe('detectAndConfirmPopup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('容器不存在 → no-popup', () => {
    document.body.innerHTML = '<div>nothing here</div>';
    expect(detectAndConfirmPopup(document)).toEqual({ status: 'no-popup' });
  });

  test('jb_dialog 容器 + jb_btn_92 nextChapter 按钮 → confirmed + click', () => {
    document.body.innerHTML = `
      <div class="jb_dialog">
        <a class="jb_btn jb_btn_92 fr fs14 nextChapter">继续学习</a>
      </div>
    `;
    const btn = document.querySelector<HTMLAnchorElement>('a.nextChapter')!;
    const clickSpy = vi.spyOn(btn, 'click');

    const r = detectAndConfirmPopup(document);
    expect(r.status).toBe('confirmed');
    if (r.status === 'confirmed') {
      expect(r.container).toBe('.jb_dialog');
      expect(r.confirm).toContain('nextChapter');
    }
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('容器隐藏 → no-popup（即便按钮在 DOM 里）', () => {
    document.body.innerHTML = `
      <div class="jb_dialog" style="display:none">
        <a class="jb_btn jb_btn_92 fr fs14 nextChapter">继续</a>
      </div>
    `;
    expect(detectAndConfirmPopup(document)).toEqual({ status: 'no-popup' });
  });

  test('安全保护：容器不在但页面有 .nextChapter 按钮 → 不点（no-popup）', () => {
    // 防止误把页面正常的"下一章节"按钮当弹窗按钮点
    document.body.innerHTML = `
      <a class="jb_btn jb_btn_92 fr fs14 nextChapter">下一节</a>
    `;
    const btn = document.querySelector<HTMLAnchorElement>('a.nextChapter')!;
    const clickSpy = vi.spyOn(btn, 'click');

    expect(detectAndConfirmPopup(document)).toEqual({ status: 'no-popup' });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  test('容器存在但里面 + 全局都找不到确认按钮 → no-confirm-button', () => {
    document.body.innerHTML = `
      <div class="jb_dialog">
        <p>未完成任务</p>
      </div>
    `;
    const r = detectAndConfirmPopup(document);
    expect(r.status).toBe('no-confirm-button');
  });

  test('layui 风格弹窗', () => {
    document.body.innerHTML = `
      <div class="layui-layer-dialog">
        <a class="layui-layer-btn0">确定</a>
      </div>
    `;
    const btn = document.querySelector<HTMLAnchorElement>('.layui-layer-btn0')!;
    const clickSpy = vi.spyOn(btn, 'click');

    const r = detectAndConfirmPopup(document);
    expect(r.status).toBe('confirmed');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  test('自定义 selector 覆盖默认值', () => {
    document.body.innerHTML = `
      <div class="custom-modal">
        <button class="ok-btn">OK</button>
      </div>
    `;
    const btn = document.querySelector<HTMLButtonElement>('.ok-btn')!;
    const clickSpy = vi.spyOn(btn, 'click');

    const r = detectAndConfirmPopup(document, {
      containerSelectors: ['.custom-modal'],
      confirmSelectors: ['.ok-btn'],
    });
    expect(r.status).toBe('confirmed');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
