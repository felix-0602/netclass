// 章节级编排：扫当前章节所有任务点 → 调对应 handler → 走完后跳下一节
//
// 上层逻辑：URL 变化（包括首次 boot）→ runChapter → 视频/PPT/作业各 handler 跑完 →
// 不是视频任务 → 主动 jumpNextChaoxingTask；视频任务 → 让 padder onEnded 自己 jump。
//
// "整门课走完"由外层 main.ts 通过 watchUrl 自然驱动：
//   - jumpNext 触发 URL 变化
//   - watchUrl 检测到 → 重跑 runChapter
//   - 直到 jumpNext 返回 at_end / no_button → loop 自停

import { runFiller } from '../answer/filler';
import { jumpNextChaoxingTask, type JumpResult } from '../time-padder/chaoxing-task';
import { startChaoxingMediaPadders } from '../time-padder/chaoxing-video';
import { scanIframes, resolveWorkDoc } from './iframe-dispatch';
import { runtimeState, patchRuntimeState } from './state';
import { processBook, processPptReader } from './task-handlers';

const COURSE_RUNNER_MEDIA_ENDED_KEY = 'course-runner-media-ended';

export interface ChapterResult {
  status: 'completed' | 'at-end' | 'no-button' | 'video-pending' | 'no-tasks';
  handled: number;
  jump?: JumpResult;
}

export interface RunChapterOptions {
  /** 任务间 settle delay，给 chaoxing 统计请求收尾，默认 1500ms */
  interTaskDelayMs?: number;
  /** 跳下一节前 settle delay，默认 3000ms */
  preJumpDelayMs?: number;
}

/**
 * 处理当前章节（顶层 doc 一次扫描）所有任务点。
 *
 * - work iframe → runFiller（含 compose for math）
 * - document-reader iframe → processPptReader
 * - ebook iframe → processBook
 * - video/audio iframe → adapter 的 padder 已自动播 + 播完 jumpNext
 * - finished/ignored → 跳过
 *
 * 走完后，若没有 video（video 自动会 jump），主动 jumpNextChaoxingTask。
 */
export async function runChapter(
  rootDoc: Document = document,
  opts: RunChapterOptions = {},
): Promise<ChapterResult> {
  const { interTaskDelayMs = 1500, preJumpDelayMs = 3000 } = opts;

  const metas = scanIframes(rootDoc);
  const tasks = metas.filter((m) => m.kind !== 'ignored');

  if (tasks.length === 0) {
    patchRuntimeState({ message: '当前页未识别到任务点，自动跳下一节' });
    await sleep(preJumpDelayMs);
    const jump = await jumpNextChaoxingTask({
      root: rootDoc,
      settleDelaySec: 0,
      popupRetryMs: 1500,
    });
    if (jump.status === 'jumped') return { status: 'completed', handled: 0, jump };
    if (jump.status === 'at_end') {
      patchRuntimeState({
        status: 'idle',
        phase: 'course-done',
        message: '🎉 整门课走完',
      });
      return { status: 'at-end', handled: 0, jump };
    }
    patchRuntimeState({ message: '⚠ 找不到下一节按钮，停' });
    return { status: 'no-button', handled: 0, jump };
  }

  let videoSeen = false;
  let mediaJumpScheduled = false;
  let handled = 0;

  for (const m of tasks) {
    if (m.kind === 'finished') {
      handled++;
      continue;
    }

    patchRuntimeState({
      phase: `task: ${m.kind}`,
      message: `处理 ${m.kind} iframe`,
    });

    try {
      switch (m.kind) {
        case 'work': {
          // resolveWorkDoc 等待 work 壳内层 api/work iframe 创建 + .TiMu 渲染（网慢防跳过）
          const doc = await resolveWorkDoc(m.iframe);
          if (doc) {
            await runFiller(doc, { autoSubmit: true });
            handled++;
          } else {
            console.warn('[course-runner] work iframe 内容加载超时，跳过');
          }
          break;
        }
        case 'document-reader': {
          const r = await processPptReader(m.iframe);
          if (r.ok) handled++;
          else console.warn('[course-runner] PPT failed:', r.reason);
          break;
        }
        case 'ebook': {
          const r = await processBook(m.iframe);
          if (r.ok) handled++;
          else console.warn('[course-runner] book failed:', r.reason);
          break;
        }
        case 'video':
        case 'audio': {
          const doc = m.iframe.contentDocument;
          if (doc) {
            startChaoxingMediaPadders(doc, {
              subscriptionKey: COURSE_RUNNER_MEDIA_ENDED_KEY,
              onEnded: () => {
                if (mediaJumpScheduled) return;
                mediaJumpScheduled = true;
                patchRuntimeState({ message: '视频/音频已播完，正在跳下一节' });
                void jumpNextChaoxingTask({
                  root: rootDoc,
                  settleDelaySec: preJumpDelayMs / 1000,
                  popupRetryMs: 1500,
                }).then((jump) => {
                  if (jump.status === 'at_end' || jump.status === 'no_button') {
                    courseProgress.active = false;
                  }
                  patchRuntimeState({
                    message:
                      jump.status === 'jumped'
                        ? `视频/音频完成，已跳下一节（${jump.buttonSelector}）`
                        : `视频/音频完成，跳转结果：${jump.status}`,
                  });
                });
              },
            });
          }
          videoSeen = true;
          handled++;
          break;
        }
      }
    } catch (e) {
      console.warn('[course-runner] task threw:', m.kind, e);
    }

    await sleep(interTaskDelayMs);
  }

  // 视频任务：让 padder 的 onEnded 处理 jump，避免抢先点 next 把还没播完的视频跳过
  if (videoSeen) {
    patchRuntimeState({ message: `视频任务等播完 → 自动跳下一节` });
    return { status: 'video-pending', handled };
  }

  // 非视频任务：主动跳下一节（带 popup 自动确认 — 弹窗拦下时自动放行）
  patchRuntimeState({ message: `本节完成，${preJumpDelayMs / 1000}s 后跳下一节` });
  await sleep(preJumpDelayMs);
  const jump = await jumpNextChaoxingTask({
    root: rootDoc,
    settleDelaySec: 0,
    popupRetryMs: 1500,
  });

  if (jump.status === 'jumped') {
    patchRuntimeState({ message: `跳下一节（${jump.buttonSelector}）` });
    return { status: 'completed', handled, jump };
  }
  if (jump.status === 'at_end') {
    patchRuntimeState({
      status: 'idle',
      phase: 'course-done',
      message: '🎉 整门课走完',
    });
    return { status: 'at-end', handled, jump };
  }
  patchRuntimeState({ message: '⚠ 找不到下一节按钮，停' });
  return { status: 'no-button', handled, jump };
}

/**
 * 整门课全自动模式 —— 用户在 Panel 点"全课代戉"时调。
 * 用 watchUrl 监听 URL 变化驱动循环（避免在一个 promise 里硬等 N 次跳转）。
 */
export interface RunCourseOptions extends RunChapterOptions {
  /** 最多跑多少节，防失控，默认 100 */
  maxChapters?: number;
  /** 每次 URL 变化后等多久再扫，默认 4000ms（让 iframe 加载） */
  urlChangeSettleMs?: number;
}

/** 全课循环进度计数。供 Panel 显示。 */
export const courseProgress = {
  active: false,
  running: false,
  chaptersHandled: 0,
  startedAt: 0,
};

export function startCourseRunner(rootDoc: Document = document): void {
  if (courseProgress.active) {
    console.info('[course-runner] already active');
    return;
  }
  courseProgress.active = true;
  courseProgress.running = false;
  courseProgress.chaptersHandled = 0;
  courseProgress.startedAt = Date.now();
  patchRuntimeState({
    automationEnabled: true,
    message: '全课代戉已启动',
  });
  // 立刻跑一次当前章节
  void runChapterAndCount(rootDoc);
}

export function stopCourseRunner(): void {
  courseProgress.active = false;
  patchRuntimeState({ message: '全课代戉已停' });
}

async function runChapterAndCount(rootDoc: Document): Promise<void> {
  if (!courseProgress.active) return;
  if (courseProgress.running) {
    console.info('[course-runner] skip - chapter run already in flight');
    return;
  }
  courseProgress.running = true;
  try {
    const result = await runChapter(rootDoc);
    if (result.status !== 'video-pending' && result.status !== 'no-tasks') {
      courseProgress.chaptersHandled++;
      patchRuntimeState({
        message: `已过 ${courseProgress.chaptersHandled} 节`,
      });
    }
    if (result.status === 'at-end' || result.status === 'no-button') {
      courseProgress.active = false;
    }
  } finally {
    courseProgress.running = false;
  }
  void runtimeState; // 保活引用
}

/** 给 main.ts 在 url-watcher 回调里调用 —— 自动接续下一节 */
export function onUrlChangeWhileRunning(rootDoc: Document = document): void {
  if (!courseProgress.active) return;
  void runChapterAndCount(rootDoc);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
