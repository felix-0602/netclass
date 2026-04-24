// 超星 adapter — Phase 0 骨架
// 详细实现计划见 docs/ARCHITECTURE.md § 2 和 docs/recon/reconnaissance-2026-04-24.md

import type { ExtractedQuestion } from './types';

export function bootChaoxing(): void {
  // Phase 0 Week 1 TODO：
  // 1. 识别当前页面类型：视频任务点 / 章节测试 / 作业
  // 2. 若视频：启动 time-padder/chaoxing-video
  // 3. 若含 .TiMu：启动题目提取 + answer flow
  //
  // 当前仅打印 placeholder，待实装。
  console.info('[netclass-sidekick/chaoxing] adapter placeholder — Phase 0 Week 1');
}

/**
 * 从当前页面（或指定 document）里提取所有题目。
 * 超星的 iframe 嵌套需要递归往内找 contentDocument。
 *
 * 参考：
 *   - docs/recon/reconnaissance-2026-04-24.md § 嵌套 iframe 三层结构
 *   - docs/recon/fixtures/chaoxing-math-gaoshu-ch7.1.json
 *   - app.js:5032 getAnswer（原脚本的接入点）
 */
export function extractQuestionsFromChaoxing(
  root: Document | ShadowRoot = document,
): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];

  // 递归进入同源 iframe
  const roots: Array<Document | ShadowRoot> = [root];
  const iframes = root.querySelectorAll('iframe');
  iframes.forEach((f) => {
    try {
      const doc = (f as HTMLIFrameElement).contentDocument;
      if (doc) roots.push(doc);
    } catch {
      // cross-origin，跳过（超星的 iframe 嵌套头两层跨域）
    }
  });

  for (const r of roots) {
    const timus = r.querySelectorAll('.TiMu');
    timus.forEach((t) => {
      // TODO Phase 0 Week 1：真实提取，目前返回空 skeleton
      void t;
    });
  }

  return questions;
}
