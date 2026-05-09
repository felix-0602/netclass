// U 校园任务导航 — 跳下一个练习 / 跳下一节
//
// U 校园跟超星的核心差异：
//   - SPA 无 iframe，"下一节"不是按钮，而是 sidebar 里的下一个练习条目
//   - ucontent.unipus.cn 页面顶部有 section tab（Before/While/After you xxx）
//   - sidebar 树形展示当前 section 下的 exercises
//   - 练习题答完即自动保存，不需要点"提交"
//
// 导航策略：
//   1. ucontent 页 → sidebar 里找下一个未完成的 exercise，点击
//   2. 当前 section 走完 → 点下一个 section tab
//   3. 整 unit 走完 → 无（靠 main.ts url-watch 回 uai 页重新选 unit）

export interface UnipusJumpResult {
  status: 'jumped' | 'section-done' | 'no-more' | 'not-on-exercise';
  target?: string;
}

/**
 * 跳转到下一个练习。
 * 在 ucontent 页面的 sidebar 中查找当前 exercise 之后的下一个 exercise。
 */
export function jumpNextUnipusTask(rootDoc: Document = document): UnipusJumpResult {
  // 只在 ucontent 页面工作
  if (!isUcontent(rootDoc)) {
    return { status: 'not-on-exercise' };
  }

  // 找到 sidebar 中所有 exercise 条目
  const exercises = findExerciseItems(rootDoc);
  if (exercises.length === 0) {
    return { status: 'no-more' };
  }

  // 尝试从某个激活态判断当前位置
  const currentIdx = findCurrentExerciseIndex(exercises);
  const nextIdx = currentIdx >= 0 ? currentIdx + 1 : 0;

  if (nextIdx >= exercises.length) {
    // 当前 section 的 exercise 走完了，试下一个 section
    return tryNextSection(rootDoc);
  }

  const next = exercises[nextIdx];
  if (next) {
    next.click();
    return { status: 'jumped', target: next.textContent?.trim().slice(0, 40) };
  }

  return { status: 'no-more' };
}

/**
 * 在当前页面上跑完所有练习（自动循环）。
 * 返回最终状态。
 */
export async function runAllExercises(
  rootDoc: Document,
  onExercise: (doc: Document) => Promise<void>,
): Promise<UnipusJumpResult> {
  if (!isUcontent(rootDoc)) {
    return { status: 'not-on-exercise' };
  }

  let result: UnipusJumpResult;
  let safety = 0;
  const MAX = 50; // 最多 50 题，防无限循环

  do {
    // 等页面 settle
    await sleep(1500);

    // 跑当前页面的题目
    await onExercise(rootDoc);

    // 跳下一个
    result = jumpNextUnipusTask(rootDoc);
    safety++;

    if (result.status === 'jumped') {
      // 等新页面加载
      await sleep(3000);
    }
  } while (result.status === 'jumped' && safety < MAX);

  return result;
}

// ---- helpers ----

function isUcontent(doc: Document): boolean {
  try {
    const host = doc.location?.hostname ?? doc.defaultView?.location?.hostname ?? '';
    return host.includes('ucontent.unipus.cn');
  } catch {
    return false;
  }
}

/** sidebar 里找所有 exercise 条目 */
function findExerciseItems(doc: Document): HTMLElement[] {
  // ucontent 页侧边栏：exercise 条目在 catalog/slider 里
  // 条目特征：cursor:pointer + 无特定 "active" class 的文本节点
  const all = doc.querySelectorAll<HTMLElement>(
    '.pc-slider [class*="item"], .catalog_points_yi, [class*="catalog"] [class*="task"], [class*="header-tab"]',
  );
  return Array.from(all).filter((el) => {
    const text = el.textContent?.trim() ?? '';
    return text.length > 0 && text.length < 80;
  });
}

/** 判断当前在哪道题（激活态或最近点过的） */
function findCurrentExerciseIndex(exercises: HTMLElement[]): number {
  for (let i = 0; i < exercises.length; i++) {
    const el = exercises[i]!;
    if (
      el.classList.contains('active') ||
      el.classList.contains('selected') ||
      el.getAttribute('aria-current') === 'true' ||
      el.querySelector('[class*="active"]')
    ) {
      return i;
    }
  }
  return -1;
}

/** 当前 section exercise 走完 → 切下一个 section tab */
function tryNextSection(doc: Document): UnipusJumpResult {
  const sections = doc.querySelectorAll<HTMLElement>('[class*="header-tab"]');
  let currentFound = false;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (s.classList.contains('pc-header-tab-activity') || s.classList.contains('active')) {
      currentFound = true;
      continue;
    }
    if (currentFound) {
      s.click();
      return { status: 'jumped', target: s.textContent?.trim().slice(0, 40) };
    }
  }

  return { status: 'section-done' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
