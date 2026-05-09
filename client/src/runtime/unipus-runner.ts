// U 校园章节编排 — 对标 chaoxing course-runner.ts
//
// 跟超星的关键差异：
//   - 无 iframe，直接在当前 doc 上操作
//   - 答案实时保存，不需要"提交"步骤
//   - 音频播完后要等一下让它记录时长
//   - 导航通过 sidebar 点击或 URL hash 修改
//
// 流程：
//   1. 检测当前是 exercise 页还是 section 页
//   2. exercise 页 → runFiller → 跳下一个 exercise
//   3. section 页 → 点 continue/开始 → 进入 exercise
//   4. unit 走完 → 无更多 exercise → 返回 no-more

import { runFiller } from '../answer/filler';
import { jumpNextUnipusTask } from '../time-padder/unipus-task';
import { patchRuntimeState } from './state';

export interface UnipusChapterResult {
  status: 'completed' | 'no-tasks' | 'no-more';
  exercisesHandled: number;
}

/**
 * 处理当前 U 校园页面：
 *   - 如果是 exercise 页（有 .question-common-abs-question-container）→ 跑 filler → 跳 next
 *   - 如果只是 section 导航页 → 直接跳到第一个 exercise
 *   - 如果没有题目 → 跳过
 */
export async function runUnipusChapter(
  rootDoc: Document = document,
): Promise<UnipusChapterResult> {
  if (!isUnipusContent(rootDoc)) {
    return { status: 'no-tasks', exercisesHandled: 0 };
  }

  let handled = 0;

  // 检测当前页是否有题目
  const hasQuestions = rootDoc.querySelectorAll(
    '.question-common-abs-question-container',
  ).length > 0;

  if (hasQuestions) {
    // 是 exercise 页 → 跑 filler
    patchRuntimeState({
      phase: 'answer',
      message: `U 校园：正在答题`,
    });
    await runFiller(rootDoc);
    handled++;
  } else {
    // 可能是 section 导航页（Before/While/After 的顶层）或 info 页
    // 尝试直接跳到第一个 exercise
    patchRuntimeState({
      phase: 'navigate',
      message: `U 校园：跳到第一个练习`,
    });
  }

  // 跳下一个 exercise
  const jump = jumpNextUnipusTask(rootDoc);

  if (jump.status === 'no-more' || jump.status === 'section-done') {
    patchRuntimeState({
      message: `U 校园：本节完成（处理 ${handled} 题）`,
    });
    return { status: 'no-more', exercisesHandled: handled };
  }

  if (jump.status === 'jumped') {
    patchRuntimeState({
      message: `U 校园：已跳 → ${jump.target ?? 'next'}`,
    });
    return { status: 'completed', exercisesHandled: handled };
  }

  return { status: 'no-tasks', exercisesHandled: handled };
}

/** 检测是否在 U 校园内容页 */
export function isUnipusContent(doc: Document = document): boolean {
  try {
    const host = doc.location?.hostname ?? doc.defaultView?.location?.hostname ?? '';
    return host.includes('ucontent.unipus.cn') || host.includes('uai.unipus.cn');
  } catch {
    return false;
  }
}

/** 检测当前页是否有可执行的题目 */
export function hasUnipusExercises(doc: Document = document): boolean {
  return (
    doc.querySelectorAll('.question-common-abs-question-container').length > 0 ||
    doc.querySelectorAll('[class*="taskItemContainer"]').length > 0
  );
}
