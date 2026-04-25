import { beforeEach, describe, expect, test, vi } from 'vitest';
import { processPptReader } from '../src/runtime/task-handlers';

// 用 happy-dom 起一个真 iframe，把内层 doc 自己控
function setupIframe(innerHtml: string): HTMLIFrameElement {
  document.body.innerHTML = '<iframe id="ppt"></iframe>';
  const f = document.getElementById('ppt') as HTMLIFrameElement;
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<html><body>${innerHtml}</body></html>`);
  doc.close();
  return f;
}

describe('processPptReader fallback chain', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('iframe 没 contentWindow → ok=false', async () => {
    const f = document.createElement('iframe');
    // 不挂到 DOM，contentWindow 仍可能为 null
    Object.defineProperty(f, 'contentWindow', { value: null });
    Object.defineProperty(f, 'contentDocument', { value: null });
    const r = await processPptReader(f);
    expect(r.ok).toBe(false);
  });

  test('兜底走 iframe 自身 doc 滚动', async () => {
    const f = setupIframe('<div style="height:5000px">long content</div>');
    const ifWin = f.contentWindow as Window;
    const scrollSpy = vi.spyOn(ifWin, 'scrollTo');

    const r = await processPptReader(f);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('iframe 自身 document');
    expect(scrollSpy).toHaveBeenCalled();
  });

  test('优先走 #panView 内层 iframe', async () => {
    const f = setupIframe('<iframe id="panView"></iframe><div>outer</div>');
    const inner = f.contentDocument!.querySelector<HTMLIFrameElement>('#panView')!;
    const innerDoc = inner.contentDocument!;
    innerDoc.open();
    innerDoc.write('<body><div style="height:9000px">slides</div></body>');
    innerDoc.close();

    const innerWin = inner.contentWindow as Window;
    const innerSpy = vi.spyOn(innerWin, 'scrollTo');
    const outerSpy = vi.spyOn(f.contentWindow as Window, 'scrollTo');

    const r = await processPptReader(f);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('#panView 内层 iframe');
    expect(innerSpy).toHaveBeenCalled();
    expect(outerSpy).not.toHaveBeenCalled();
  });

  test('.ans-attach-ct insertdoc fallback（panView 不存在时）', async () => {
    const f = setupIframe(`
      <div class="ans-attach-ct">
        <iframe id="insertdoc"></iframe>
      </div>
    `);
    const insertDoc = f.contentDocument!.querySelector<HTMLIFrameElement>('.ans-attach-ct iframe')!;
    const idDoc = insertDoc.contentDocument!;
    idDoc.open();
    idDoc.write('<body><div style="height:7000px">pptx</div></body>');
    idDoc.close();

    const idWin = insertDoc.contentWindow as Window;
    const idSpy = vi.spyOn(idWin, 'scrollTo');

    const r = await processPptReader(f);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('.ans-attach-ct insertdoc iframe');
    expect(idSpy).toHaveBeenCalled();
  });

  test('panView 存在但访问 contentWindow 抛错 → 兜底 .ans-attach-ct 或 iframe 自身', async () => {
    const f = setupIframe(`
      <iframe id="panView"></iframe>
      <div class="ans-attach-ct"><iframe id="insertdoc"></iframe></div>
    `);
    const panView = f.contentDocument!.querySelector<HTMLIFrameElement>('#panView')!;
    // 模拟跨域 — 把 contentWindow 强制设 null
    Object.defineProperty(panView, 'contentWindow', { value: null, configurable: true });
    Object.defineProperty(panView, 'contentDocument', { value: null, configurable: true });

    const insertDoc = f.contentDocument!.querySelector<HTMLIFrameElement>('.ans-attach-ct iframe')!;
    insertDoc.contentDocument!.open();
    insertDoc.contentDocument!.write('<body><div style="height:5000px">x</div></body>');
    insertDoc.contentDocument!.close();

    const r = await processPptReader(f);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('.ans-attach-ct insertdoc iframe');
  });
});
