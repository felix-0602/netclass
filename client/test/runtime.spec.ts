import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolvePageKind } from '../src/runtime/router';
import { watchInnerIframeUrls, watchUrl } from '../src/runtime/url-watcher';
import { classifyIframe, scanIframes, dispatchIframes } from '../src/runtime/iframe-dispatch';

describe('router.resolvePageKind', () => {
  test('chaoxing 章节学习页', () => {
    expect(resolvePageKind({
      hostname: 'mooc1.chaoxing.com',
      pathname: '/mycourse/studentstudy',
    })).toBe('chaoxing-chapter');
  });

  test('chaoxing knowledge/cards 子 iframe 也算 chapter', () => {
    expect(resolvePageKind({
      hostname: 'mooc1.chaoxing.com',
      pathname: '/mooc-ans/knowledge/cards',
    })).toBe('chaoxing-chapter');
  });

  test('chaoxing 作业页', () => {
    expect(resolvePageKind({
      hostname: 'mooc1.chaoxing.com',
      pathname: '/mooc2/work/dowork',
    })).toBe('chaoxing-homework');
  });

  test('chaoxing 考试页', () => {
    expect(resolvePageKind({
      hostname: 'mooc1.chaoxing.com',
      pathname: '/exam-ans/exam',
    })).toBe('chaoxing-exam');
  });

  test('知到考试页', () => {
    expect(resolvePageKind({
      hostname: 'onlineexamh5new.zhihuishu.com',
      pathname: '/stuExamWeb',
    })).toBe('zhihuishu-exam');
  });

  test('U 校园（整站）', () => {
    expect(resolvePageKind({
      hostname: 'uai.unipus.cn',
      pathname: '/home',
    })).toBe('unipus-page');
  });

  test('学校域名挂的超星（nbdlib/hnsyu 等）', () => {
    expect(resolvePageKind({
      hostname: 'mooc.nbdlib.cn',
      pathname: '/mycourse/studentstudy',
    })).toBe('chaoxing-chapter');
  });

  test('完全不相关域名 → unknown', () => {
    expect(resolvePageKind({
      hostname: 'google.com',
      pathname: '/search',
    })).toBe('unknown');
  });

  test('chaoxing 主域名但 path 不命中 → unknown', () => {
    expect(resolvePageKind({
      hostname: 'i.chaoxing.com',
      pathname: '/base',
    })).toBe('unknown');
  });
});

describe('url-watcher.watchUrl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('URL 不变不触发', () => {
    let url = '/a';
    const onChange = vi.fn();
    watchUrl(onChange, { intervalMs: 1000, getUrl: () => url });

    vi.advanceTimersByTime(5_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('URL 变化触发，带上新旧 URL', () => {
    let url = '/a';
    const onChange = vi.fn();
    watchUrl(onChange, { intervalMs: 1000, getUrl: () => url });

    url = '/b';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledWith('/b', '/a');

    url = '/c';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledWith('/c', '/b');
  });

  test('cleanup 后不再触发', () => {
    let url = '/a';
    const onChange = vi.fn();
    const stop = watchUrl(onChange, { intervalMs: 1000, getUrl: () => url });

    stop();
    url = '/b';
    vi.advanceTimersByTime(5_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('onChange 抛错不会中断轮询', () => {
    let url = '/a';
    const onChange = vi.fn().mockImplementationOnce(() => {
      throw new Error('boom');
    });
    watchUrl(onChange, { intervalMs: 1000, getUrl: () => url });

    url = '/b';
    vi.advanceTimersByTime(1_000);
    url = '/c';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledTimes(2); // 第一次抛错，但第二次仍触发
  });
});

describe('url-watcher.watchInnerIframeUrls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('iframe src 不变不触发', () => {
    document.body.innerHTML = '<iframe src="https://a.com/cards?num=1"></iframe>';
    const onChange = vi.fn();
    watchInnerIframeUrls(onChange, { intervalMs: 1000 });

    vi.advanceTimersByTime(5_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('iframe src 变化触发，带新旧 src + iframe 引用', () => {
    document.body.innerHTML = '<iframe id="f" src="https://a.com/cards?num=1"></iframe>';
    const f = document.getElementById('f') as HTMLIFrameElement;
    const onChange = vi.fn();
    watchInnerIframeUrls(onChange, { intervalMs: 1000 });

    // 先 1s 让初始 src 被记录
    vi.advanceTimersByTime(1_000);
    expect(onChange).not.toHaveBeenCalled();

    f.src = 'https://a.com/cards?num=2';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0];
    expect(arg.src).toContain('num=2');
    expect(arg.prevSrc).toContain('num=1');
    expect(arg.iframe).toBe(f);
  });

  test('cleanup 后不再触发', () => {
    document.body.innerHTML = '<iframe id="f" src="https://a.com/?n=1"></iframe>';
    const f = document.getElementById('f') as HTMLIFrameElement;
    const onChange = vi.fn();
    const stop = watchInnerIframeUrls(onChange, { intervalMs: 1000 });

    vi.advanceTimersByTime(1_000); // 初始化
    stop();
    f.src = 'https://a.com/?n=2';
    vi.advanceTimersByTime(5_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('多 iframe 各自独立追踪', () => {
    document.body.innerHTML = `
      <iframe id="a" src="https://x.com/?p=1"></iframe>
      <iframe id="b" src="https://y.com/?q=1"></iframe>
    `;
    const a = document.getElementById('a') as HTMLIFrameElement;
    const onChange = vi.fn();
    watchInnerIframeUrls(onChange, { intervalMs: 1000 });

    vi.advanceTimersByTime(1_000); // 初始化
    a.src = 'https://x.com/?p=2';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].iframe).toBe(a);
  });

  test('onChange 抛错不会中断轮询', () => {
    document.body.innerHTML = '<iframe id="f" src="https://a.com/?n=1"></iframe>';
    const f = document.getElementById('f') as HTMLIFrameElement;
    const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('boom'); });
    watchInnerIframeUrls(onChange, { intervalMs: 1000 });

    vi.advanceTimersByTime(1_000);
    f.src = 'https://a.com/?n=2';
    vi.advanceTimersByTime(1_000);
    f.src = 'https://a.com/?n=3';
    vi.advanceTimersByTime(1_000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('iframe-dispatch.classifyIframe', () => {
  test('api/work 路径 → work', () => {
    const f = document.createElement('iframe');
    f.src = 'https://mooc1.chaoxing.com/mooc-ans/api/work?workId=123';
    expect(classifyIframe(f).kind).toBe('work');
  });

  test('modules/video → video', () => {
    const f = document.createElement('iframe');
    f.src = 'https://mooc1.chaoxing.com/ananas/modules/video/index.html';
    expect(classifyIframe(f).kind).toBe('video');
  });

  test('modules/ppt → document-reader', () => {
    const f = document.createElement('iframe');
    f.src = 'https://mooc1.chaoxing.com/ananas/modules/ppt/view.html';
    expect(classifyIframe(f).kind).toBe('document-reader');
  });

  test('modules/innerbook → ebook', () => {
    const f = document.createElement('iframe');
    f.src = 'https://mooc1.chaoxing.com/ananas/modules/innerbook/';
    expect(classifyIframe(f).kind).toBe('ebook');
  });

  test('父元素 class 含 ans-job-finished → finished', () => {
    const parent = document.createElement('div');
    parent.className = 'ans-job-finished';
    const f = document.createElement('iframe');
    f.src = 'https://mooc1.chaoxing.com/ananas/modules/video/index.html';
    parent.appendChild(f);
    expect(classifyIframe(f).kind).toBe('finished');
  });

  test('javascript: src → ignored', () => {
    const f = document.createElement('iframe');
    f.src = 'javascript:void(0)';
    expect(classifyIframe(f).kind).toBe('ignored');
  });

  test('未识别 → ignored', () => {
    const f = document.createElement('iframe');
    f.src = 'https://example.com/random';
    expect(classifyIframe(f).kind).toBe('ignored');
  });
});

describe('iframe-dispatch.scanIframes + dispatchIframes', () => {
  test('扫到多种类型并派到各自 handler', async () => {
    document.body.innerHTML = `
      <iframe id="f1" src="https://mooc1.chaoxing.com/mooc-ans/api/work?x=1"></iframe>
      <iframe id="f2" src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe>
      <iframe id="f3" src="javascript:void(0)"></iframe>
    `;
    const metas = scanIframes(document);
    expect(metas.map((m) => m.kind)).toEqual(['work', 'video', 'ignored']);

    const onWork = vi.fn();
    const onVideo = vi.fn();
    await dispatchIframes(document, { onWork, onVideo });
    expect(onWork).toHaveBeenCalledTimes(1);
    expect(onVideo).toHaveBeenCalledTimes(1);
  });

  test('handler 抛错不会卡死其他 handler', async () => {
    document.body.innerHTML = `
      <iframe id="f1" src="https://mooc1.chaoxing.com/mooc-ans/api/work?x=1"></iframe>
      <iframe id="f2" src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe>
    `;
    const onWork = vi.fn().mockRejectedValue(new Error('work boom'));
    const onVideo = vi.fn();
    await dispatchIframes(document, { onWork, onVideo });
    expect(onVideo).toHaveBeenCalledTimes(1);
  });

  test('finished iframe 走 onFinished 不走 onVideo', async () => {
    document.body.innerHTML = `
      <div class="ans-job-finished">
        <iframe src="https://mooc1.chaoxing.com/ananas/modules/video/index.html"></iframe>
      </div>
    `;
    const onVideo = vi.fn();
    const onFinished = vi.fn();
    await dispatchIframes(document, { onVideo, onFinished });
    expect(onVideo).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
