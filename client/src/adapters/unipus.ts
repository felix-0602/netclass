// U 校园 adapter — Phase 1 Week 2 实装
// 详细：docs/recon/reconnaissance-2026-04-24.md § U 校园
//       docs/recon/fixtures/unipus-listening-fill.json

import type { ExtractedQuestion } from './types';

export function bootUnipus(): void {
  // Phase 1 Week 2 TODO：
  // 1. 等 React hydrate（setTimeout 500ms 或 watch .question-common-abs 出现）
  // 2. 若视频任务：time-padder/unipus-video（含活跃度模拟）
  // 3. 若 exercise 页：提取 .question-common-abs-question-container
  //
  console.info('[netclass-sidekick/unipus] adapter placeholder — Phase 1 Week 2');
}

export function extractQuestionsFromUnipus(
  root: Document | ShadowRoot = document,
): ExtractedQuestion[] {
  const containers = root.querySelectorAll('.question-common-abs-question-container');
  const out: ExtractedQuestion[] = [];

  containers.forEach((c) => {
    // TODO Phase 1 Week 2：实装
    void c;
  });

  return out;
}
