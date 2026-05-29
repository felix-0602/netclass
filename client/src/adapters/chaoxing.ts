// 超星 adapter — 题目提取器
// 参考：
//   - docs/recon/reconnaissance-2026-04-24.md § 嵌套 iframe 三层结构
//   - docs/recon/fixtures/chaoxing-math-gaoshu-ch7.1.json
//   - app.js:5032 getAnswer（原脚本的接入点，本 adapter 的上游）

import { decryptDocument } from '../decode/cxsecret';
import { applyAntiBackground } from '../runtime/anti-background';
import { jumpNextChaoxingTask } from '../time-padder/chaoxing-task';
import { startChaoxingMediaPadders } from '../time-padder/chaoxing-video';
import type { ExtractedQuestion, QuestionOption, QuestionType, TexSpan } from './types';

// TiMu 里 data-属性值的 questiontype 映射
// 参考 app.js 原 answertype 字段语义
const QTYPE_MAP: Record<string, QuestionType> = {
  '0': 'single',
  '1': 'multi',
  '2': 'fill',
  '3': 'judge',
  '4': 'essay',
};

/**
 * Phase 0 Week 1：启动超星刷时长闭环。
 *
 * 在当前 document 以及所有同源 iframe 内找 <video>/<audio>，挂上
 * padder；当视频播完触发 `onEnded` 时自动等 3 秒后点"下一章节" 按钮。
 *
 * 返回一个清理函数，外部可在路由切换时解绑所有监听。
 */
export function bootChaoxing(rootDoc: Document = document): () => void {
  // eslint-disable-next-line no-console
  console.info('[netclass-sidekick/chaoxing] adapter 启动');

  const docs = collectSameOriginDocs(rootDoc);
  const cleanups: Array<() => void> = [];

  // 避免视频结束后多次触发（一页可能有多个 iframe 都含同一个结束事件）
  let hasJumped = false;

  for (const d of docs) {
    if (!isDocument(d)) continue;

    // 反"切到后台 / 鼠标不在视频"检测：每个同源 doc 都跑一次
    cleanups.push(applyAntiBackground(d));

    const cleanup = startChaoxingMediaPadders(d, {
      onEnded: () => {
        if (hasJumped) return;
        hasJumped = true;
        // 触发跳转，但失败不致命——log 即可
        void jumpNextChaoxingTask({ root: rootDoc }).then((result) => {
          // eslint-disable-next-line no-console
          console.info('[netclass-sidekick/chaoxing] 跳转结果:', result.status);
        });
      },
    });
    cleanups.push(cleanup);
  }

  return () => cleanups.forEach((fn) => fn());
}

/**
 * 递归收集当前 root + 所有**同源**子 iframe 的 Document，
 * 供统一扫描 `.TiMu` 节点用。
 */
function collectSameOriginDocs(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const out: Array<Document | ShadowRoot> = [root];
  const iframes = root.querySelectorAll('iframe');
  iframes.forEach((frame) => {
    try {
      const doc = (frame as HTMLIFrameElement).contentDocument;
      if (doc) {
        out.push(...collectSameOriginDocs(doc));
      }
    } catch {
      // cross-origin，跳过（超星 iframe 头两层跨域）
    }
  });
  return out;
}

/**
 * 从当前页面（或指定 document）提取所有 `.TiMu` 题目。
 * 递归钻进同源 iframe；调用前会对每个 doc 先做字体解混淆（副作用：修改 DOM）。
 */
export function extractQuestionsFromChaoxing(
  root: Document | ShadowRoot = document,
): ExtractedQuestion[] {
  const docs = collectSameOriginDocs(root);
  const questions: ExtractedQuestion[] = [];

  for (const d of docs) {
    // 只有 Document 级能做字体解混淆（Shadow DOM 字体表不典型）
    if (isDocument(d)) {
      decryptDocument(d);
    }

    const timus = d.querySelectorAll<HTMLElement>('.TiMu');
    timus.forEach((timu) => {
      const parsed = parseTiMu(timu);
      if (parsed) questions.push(parsed);
    });
  }

  // 阅读材料+多题检测: 将复合型题目重组为 composite 结构
  // 待实测验证: 超星阅读材料的 DOM 结构可能为 TiMu 嵌套 TiMu，
  // 或由单独的 .Zy_TItle_p（材料段落）后跟多个 TiMu 组成。
  const compositeGroups = detectReadingComposites(docs, questions);
  if (compositeGroups.length > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `[netclass-sidekick/chaoxing] 检测到 ${compositeGroups.length} 组阅读材料+多题`,
    );
    // Replace original questions with re-structured ones that include composite info
    applyCompositeStructure(questions, compositeGroups);
  }

  // 提取后质量审计：统计 null-LaTeX 依赖视觉的题占比
  let blindCount = 0;
  let nullLatexCount = 0;
  for (const q of questions) {
    const hasBlind = q.tex_spans.some(
      (t) => t.latex === null && t.image_idx !== null,
    );
    if (hasBlind) blindCount++;
    nullLatexCount += q.tex_spans.filter((t) => t.latex === null).length;
  }
  if (blindCount > 0 || nullLatexCount > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `[netclass-sidekick/chaoxing] 提取 ${questions.length} 题，${blindCount} 题含无 LaTeX 源的公式图（需 compose 合图），共 ${nullLatexCount} 个 null-LaTeX span`,
    );
  }

  return questions;
}

function isDocument(node: Document | ShadowRoot): node is Document {
  return (node as Document).querySelectorAll !== undefined
    && (node as Document).defaultView !== undefined;
}

/**
 * 解析一个 `.TiMu` 节点为 ExtractedQuestion。
 * 失败（缺关键字段）返回 null。
 */
function parseTiMu(timu: HTMLElement): ExtractedQuestion | null {
  // 提题干区（含图片）— 多组备选 selector，适应不同超星模板
  const TITLE_SELECTORS = [
    '.Zy_TItle .font-cxsecret, .Zy_TItle',
    '.Zy_TItle_fs',             // 待实测验证: 某些超星作业模板
    '.Title',                    // 待实测验证: 部分旧版超星
    '.clearfix .font-cxsecret',  // 待实测验证: 无 Zy_TItle 容器时
    '.Zy_TItle_p',               // 待实测验证: 阅读材料题的材料容器
  ];
  const titleArea = queryWithFallback<HTMLElement>(timu, TITLE_SELECTORS);
  if (!titleArea) return null;

  // 题目 ID：从 answer input name 提（唯一稳定字段）
  const answerInput = timu.querySelector<HTMLInputElement>(
    'input[type="hidden"][name^="answer"]:not([name^="answertype"])',
  );
  const answerTypeInput = timu.querySelector<HTMLInputElement>(
    'input[type="hidden"][name^="answertype"]',
  );
  if (!answerInput) return null;
  const platformId = answerInput.name.replace(/^answer/, '');

  // 题型：从 answertypeXXX 值解析（0/1/2/3/4/5/6）
  const rawType = answerTypeInput?.value?.trim() ?? '0';
  const qtype: QuestionType = QTYPE_MAP[rawType] ?? 'single';

  // 占位符化题干：每个 <img> 替换为 <<Mn>>，同时收集图片 URL 和 LaTeX
  const images: string[] = [];
  const texSpans: TexSpan[] = [];
  const text = buildPlaceholderText(titleArea, images, texSpans);

  // 检测是否是完形填空（fill 类型但有多个空白框）
  // 完形填空的特征: 题型为 fill，题干 text 含多个 <<_>> 占位符
  const blankCount = (text.match(/<<_>>/g) ?? []).length;
  const effectiveType: QuestionType = (blankCount > 1 && qtype === 'fill') ? 'cloze' : qtype;

  // 选项
  const options = extractOptions(timu, images, texSpans);

  // 上下文元数据（含题型原始值）
  const ctx = extractContext(timu);
  // raw_question_type 记录原始题型 ID，方便服务端适配
  if (rawType !== '0' || effectiveType !== QTYPE_MAP['0']) {
    (ctx as Record<string, string | undefined>).raw_question_type = rawType;
  }

  const result: ExtractedQuestion = {
    platform_id: platformId,
    platform: 'chaoxing',
    type: effectiveType,
    text,
    options,
    tex_spans: texSpans,
    images,
    context: ctx,
    answer_target: {
      answer_input_name: answerInput.name,
      answer_type_input_name: answerTypeInput?.name,
    },
  };

  return result;
}

/**
 * 把容器内的 `<img>` 替换为 `<<Mn>>` 占位符，返回纯文本。
 * 同时把图片 src 加入 images[]、LaTeX 数据加入 texSpans[]。
 *
 * LaTeX 提取：超星在 `<img class="ans-latex-moudle" data="%22y%27%20%3D%202x%22">` 里
 * 用 URL-encoded 字符串保存原始 LaTeX 源——直接 decode 即可，省去 vision。
 * 防御：decodeURIComponent 失败时尝试原始 data 作为 fallback（部分旧版超星存未编码 LaTeX）。
 */
function buildPlaceholderText(
  container: HTMLElement,
  images: string[],
  texSpans: TexSpan[],
): string {
  // 先克隆，避免改原 DOM
  const clone = container.cloneNode(true) as HTMLElement;

  const imgs = clone.querySelectorAll('img');
  imgs.forEach((img) => {
    const src = img.getAttribute('src') ?? img.getAttribute('data-original') ?? '';
    const idx = images.length;
    images.push(src);

    const latex = extractImgLatex(img);

    const placeholder = `<<M${idx + 1}>>`;
    texSpans.push({ placeholder, latex, image_idx: idx });

    const holder = clone.ownerDocument.createTextNode(placeholder);
    img.parentNode?.replaceChild(holder, img);
  });

  // 新增: 将 <input>/<textarea> 替换为 <<_>> 空白占位符
  // 覆盖完形填空/填空题的输入框，使 text 准确反映题干中的空位
  // type=hidden 的 input 被排除（不在视觉区域展示）
  const inputs = clone.querySelectorAll<HTMLElement>(
    'input[type="text"], input[type="number"], input:not([type]), textarea',
  );
  inputs.forEach((input) => {
    const holder = clone.ownerDocument.createTextNode('<<_>>');
    input.parentNode?.replaceChild(holder, input);
  });

  return (clone.textContent ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * 从 <img> 提取 LaTeX 源码。
 *
 * 超星 LaTeX 存储在以下位置（优先级从高到低）：
 *   1. data 属性（URL-encoded 字符串，标准格式 `%22y'%20%3D%202x%22`）
 *   2. data-latex 属性（新版 kfformula 常用）
 *   3. data-formula 属性（部分旧版模板）
 *   4. alt 属性（kfformula 旧版备选）
 *
 * 防御 URL-decode 失败 + 空值 + 非 LaTeX 内容
 */
function extractImgLatex(img: HTMLImageElement): string | null {
  // 1) data 属性 — 超星 ans-latex-moudle 标准存储
  const rawData = img.getAttribute('data');
  if (rawData) {
    try {
      const decoded = decodeURIComponent(rawData);
      const stripped = decoded.replace(/^"+|"+$/g, '').trim();
      if (stripped) return stripped;
    } catch {
      // fall through
    }
    const stripped = rawData.replace(/^"+|"+$/g, '').trim();
    if (stripped && /[\\{}^_]/.test(stripped)) return stripped;
  }

  // 2) <img class="kfformula"> — 超星新版公式渲染
  //    待实测验证：部分教学班已启用 kfformula 类的公式图
  const klass = img.getAttribute('class') ?? '';
  if (klass.includes('kfformula') || klass.includes('formulaimg')) {
    // 优先 data-latex（新版统一属性）
    const dataLatex = img.getAttribute('data-latex');
    if (dataLatex) {
      const stripped = dataLatex.replace(/^"+|"+$/g, '').trim();
      if (stripped) return stripped;
    }
    // fallback: alt 属性（旧版自动生成的公式图）
    const alt = img.getAttribute('alt') ?? '';
    if (alt && /[\\{}^_a-zA-Z]/.test(alt)) return alt;
  }

  // 3) data-latex 通用属性（不依赖 class，多个平台通用）
  const dataLatex = img.getAttribute('data-latex');
  if (dataLatex) {
    const stripped = dataLatex.replace(/^"+|"+$/g, '').trim();
    if (stripped) return stripped;
  }

  // 4) data-formula 属性（部分旧版模板，未编码或半编码）
  const dataFormula = img.getAttribute('data-formula');
  if (dataFormula) {
    try {
      const decoded = decodeURIComponent(dataFormula);
      const stripped = decoded.replace(/^"+|"+$/g, '').trim();
      if (stripped) return stripped;
    } catch {
      const stripped = dataFormula.replace(/^"+|"+$/g, '').trim();
      if (stripped) return stripped;
    }
  }

  return null;
}

function extractOptions(
  timu: HTMLElement,
  images: string[],
  texSpans: TexSpan[],
): QuestionOption[] {
  // 多项备选 selector，应对超星不同模板 DOM 结构差异
  const OPTION_SELECTORS = [
    '.Zy_ulTop > li',
    '.Zy_ulBottom > li',   // 待实测验证: 部分超星模板选项在底部
    '.Zy_ul_fs > li',       // 待实测验证
    '.ul_fs > li',          // 待实测验证
    'ul.after > li',        // 待实测验证
    '.clearfix.after > li', // 待实测验证: 旧版超星
  ];
  const lis = queryAllWithFallback<HTMLElement>(timu, OPTION_SELECTORS);
  const out: QuestionOption[] = [];

  lis.forEach((li, idx) => {
    // 标签位：显示 A/B/C/D（取 `.num_option` 的 innerText），
    // 真实答案字母走 data 属性（超星有时乱序重排）
    const numOption = li.querySelector<HTMLElement>('.num_option');
    const displayLabel = numOption?.innerText?.trim()
      || String.fromCharCode(65 + idx);
    const dataLabel = numOption?.getAttribute('data')?.trim() || displayLabel;

    // 选项里可能含多个 <img>（实测高数 1.7+ 章 "方程通解是 [img1] 在区间 [img2] 内" 这种）
    // 旧版只取 firstImg + 整体 strip 所有 img → 后续 img 全丢、文字截成"方程通解是"前缀
    // 修：所有 img 都 placeholder 化（跟题干 buildPlaceholderText 同套路），文本嵌 <<M>>
    const optionHtml = li.querySelector<HTMLElement>('.after, .clearfix.after')
      ?? li;

    const cloneOpt = optionHtml.cloneNode(true) as HTMLElement;
    cloneOpt.querySelectorAll('.num_option').forEach((el) => el.remove());

    // 收集 + 替换：每个 img 在文本里留 <<Mn>> 占位符
    const optImgs = cloneOpt.querySelectorAll('img');
    const optImageRefs: string[] = [];
    optImgs.forEach((img) => {
      const src = img.getAttribute('src') ?? img.getAttribute('data-original') ?? '';
      const imgIdx = images.length;
      images.push(src);

      const latex = extractImgLatex(img);

      const placeholder = `<<M${imgIdx + 1}>>`;
      texSpans.push({ placeholder, latex, image_idx: imgIdx });
      optImageRefs.push(placeholder);

      const holder = cloneOpt.ownerDocument.createTextNode(placeholder);
      img.parentNode?.replaceChild(holder, img);
    });

    const text = (cloneOpt.textContent ?? '').trim().replace(/\s+/g, ' ') || null;

    // image_ref：单图 → placeholder（向后兼容）；多图 → 文本里已嵌占位符，ref 留 null
    const imageRef = optImageRefs.length === 1 ? optImageRefs[0]! : null;

    out.push({
      label: dataLabel,
      text: text && text !== displayLabel ? text : null,
      image_ref: imageRef,
    });
  });

  return out;
}

/**
 * 从 URL query 或 window 全局里提取 course/clazz/knowledge/work 四元组。
 * 超星在 studentstudy?chapterId=...&courseId=... 带着这些参数。
 */
function extractContext(timu: HTMLElement): ExtractedQuestion['context'] {
  const doc = timu.ownerDocument;
  const url = doc.location?.href ?? '';
  const params = new URLSearchParams(doc.location?.search ?? '');
  const ctx: ExtractedQuestion['context'] = {};

  // URL query / path 提取（现有逻辑）
  const courseId = params.get('courseId') ?? extractFromUrl(url, /courseId=(\d+)/);
  const clazzId = params.get('classId')
    ?? params.get('clazzid')
    ?? extractFromUrl(url, /classId=(\d+)/)
    ?? extractFromUrl(url, /clazzid=(\d+)/);
  const knowledgeId = params.get('knowledgeid')
    ?? params.get('chapterId')
    ?? extractFromUrl(url, /chapterId=(\d+)/)
    ?? extractFromUrl(url, /knowledgeid=(\d+)/);
  const workId = params.get('workId') ?? extractFromUrl(url, /workId=(\d+)/);

  if (courseId) ctx.course_id = courseId;
  if (clazzId) ctx.clazz_id = clazzId;
  if (knowledgeId) ctx.knowledge_id = knowledgeId;
  if (workId) ctx.work_id = workId;

  // 新增: DOM 元素元数据提取（URL 提取失败时的 fallback）
  const domMeta = extractMetadataFromDom(doc);
  if (!ctx.course_id && domMeta.courseId) ctx.course_id = domMeta.courseId;
  if (!ctx.knowledge_id && domMeta.knowledgeId) ctx.knowledge_id = domMeta.knowledgeId;
  if (!ctx.work_id && domMeta.workId) ctx.work_id = domMeta.workId;

  // 新增: 课程名跟踪
  const courseName = extractCourseNameFromDom(doc);
  if (courseName) (ctx as Record<string, string>).course_name = courseName;

  return ctx;
}

function extractFromUrl(url: string, re: RegExp): string | undefined {
  const m = url.match(re);
  return m?.[1];
}

// ============================================================
// 选择题型的备用 CSS Selector 辅助
// ============================================================

/**
 * 依次尝试多组 selector，返回第一个有结果的 querySelectorAll 结果。
 * 避免某个平台模板不存在某 selector 时直接返回空。
 */
function queryAllWithFallback<T extends Element>(
  parent: Element,
  selectors: string[],
): NodeListOf<T> {
  for (const sel of selectors) {
    const nodes = parent.querySelectorAll<T>(sel);
    if (nodes.length > 0) return nodes;
  }
  return parent.ownerDocument.querySelectorAll<T>(':invalid'); // 空结果
}

/**
 * 依次尝试多组 selector，返回第一个有结果的 querySelector 结果。
 * 用于 titleArea 等仅需单个元素的 fallback 场景。
 */
function queryWithFallback<T extends Element>(
  parent: Element,
  selectors: string[],
): T | null {
  for (const sel of selectors) {
    const el = parent.querySelector<T>(sel);
    if (el) return el;
  }
  return null;
}

// ============================================================
// 超星元数据提取 — 课程名、courseId 等从 DOM 元素提取
// ============================================================

/** localStorage key — 课程名跨页面缓存 */
const COURSE_NAME_KEY = 'netclass_chx_course_name';

/**
 * 从 DOM 导航区提取课程名。查一次后缓存到 localStorage。
 * 大学搜题酱参考模式: .nav_side .classDl dd
 */
function extractCourseNameFromDom(doc: Document): string | undefined {
  // 优先读缓存（跨页面持久）
  const cached = localStorage.getItem(COURSE_NAME_KEY);
  if (cached) return cached;

  const selectors = [
    '.nav_side .classDl dd',
    '.nav_side .slide-nav li.cur a',
    '.classDl dd',
    '.course-name',
    '.breadcrumb .active',
    '.crumb .active',
    '.topNav .courseName',       // 待实测验证
    '#coursename',               // 待实测验证
  ];
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (el) {
      const name = el.textContent?.trim();
      if (name && name.length > 0 && name.length < 100) {
        try { localStorage.setItem(COURSE_NAME_KEY, name); } catch { /* storage full, 忽略 */ }
        return name;
      }
    }
  }
  return undefined;
}

/**
 * 从 DOM 元素提取 URL 未携带的 courseId/knowledgeId/workId。
 * 超星在页面中可能通过 hidden input 或 data- 属性暴露这些值。
 */
function extractMetadataFromDom(doc: Document): {
  courseId?: string;
  knowledgeId?: string;
  workId?: string;
} {
  const result: ReturnType<typeof extractMetadataFromDom> = {};

  // #courseid hidden input（常见）
  const courseIdEl = doc.querySelector<HTMLInputElement>('#courseid');
  if (courseIdEl) {
    const val = courseIdEl.getAttribute('value') ?? courseIdEl.textContent?.trim();
    if (val) result.courseId = val;
  }

  // #knowledgeid — 待实测验证具体 DOM 路径
  const knowledgeIdEl = doc.querySelector<HTMLInputElement>('#knowledgeid');
  if (knowledgeIdEl) {
    const val = knowledgeIdEl.getAttribute('value') ?? knowledgeIdEl.textContent?.trim();
    if (val) result.knowledgeId = val;
  }

  // workId — 多种可能
  const workIdEl = doc.querySelector<HTMLElement>(
    '[name="workId"], [data-workid], #workId',
  );
  if (workIdEl) {
    const val = workIdEl.getAttribute('value')
      ?? workIdEl.getAttribute('data-workid')
      ?? workIdEl.textContent?.trim();
    if (val) result.workId = val;
  }

  // 尝试从全局变量 window 中获取（超星 SPA 挂在 window 上）— 待实测验证
  // 如果 doc.defaultView 存在，检查 window.courseId 等

  return result;
}

// ============================================================
// 阅读材料+多题 检测与重组
// ============================================================

/**
 * 检测结果：一组阅读材料包含多个子题的结构。
 * compositeIdx — 问题列表中 composite 题的位置（将被标记类型）
 * subStart    — 子题起始位置
 * subEnd      — 子题结束位置
 */
interface CompositeGroup {
  compositeIdx: number;
  subStart: number;
  subEnd: number;
}

/**
 * 在 doc 列表中搜索阅读材料+多题模式。
 *
 * 检测启发式（待实测验证）：
 *   1. DOM 结构：某 .TiMu 内嵌套了子 .TiMu 元素（parents > children）
 *   2. 文本启发：连续 3+ 题中第一题 text 长度 > 100 字且远长于后续题目
 *   3. 题型标记：chaoxing answertype=6 表示 composite 题
 *
 * 返回复合题分组列表，按问题列表中的索引范围描述。
 */
function detectReadingComposites(
  docs: Array<Document | ShadowRoot>,
  questions: ExtractedQuestion[],
): CompositeGroup[] {
  const groups: CompositeGroup[] = [];

  // --- 方法 1: DOM 结构检测（最可靠）---
  const compositeTimuIndices = new Set<number>();
  let globalIdx = 0;
  for (const d of docs) {
    const timus = d.querySelectorAll<HTMLElement>('.TiMu');
    timus.forEach((timu) => {
      // 检查当前 TiMu 是否有子 TiMu（嵌套结构是阅读材料的强信号）
      const childTimus = timu.querySelectorAll<HTMLElement>('.TiMu');
      if (childTimus.length > 1) {
        compositeTimuIndices.add(globalIdx);
        // 这些子 TiMu 也应标记在 globalIdx 之后
        // 子 TiMu 的数量决定了组的范围
        groups.push({
          compositeIdx: globalIdx,
          subStart: globalIdx + 1,
          subEnd: globalIdx + childTimus.length,
        });
      }
      globalIdx++;
    });
  }

  // --- 方法 2: 文本长度启发（当 DOM 结构不明显时）---
  // 待实测验证：扫描连续 3+ 题，如果第一题 text 明显长于后续（>3x），视为阅读材料
  if (questions.length >= 3) {
    // 仅当 DOM 检测未命中时才启用文本启发
    if (groups.length === 0) {
      for (let i = 0; i < questions.length - 2; i++) {
        const mainLen = questions[i]!.text.length;
        const nextLens = [
          questions[i + 1]!.text.length,
          questions[i + 2]!.text.length,
        ];
        // 第一题 text >= 100 字，且远长于后续两题（>3x）
        if (mainLen >= 100 && nextLens.every((l) => l > 0 && mainLen / l > 3)) {
          // 需要确定 sub 范围：找连续短题的末尾
          let subEnd = i + 1;
          while (subEnd + 1 < questions.length && questions[subEnd + 1]!.text.length < mainLen / 3) {
            subEnd++;
          }
          groups.push({
            compositeIdx: i,
            subStart: i + 1,
            subEnd,
          });
          i = subEnd; // 跳过已处理的子题
        }
      }
    }
  }

  return groups;
}

/**
 * 根据检测到的 CompositeGroup 重新组织问题列表。
 * 将复合题的类型标记为 composite，并在其 context 中记录子题信息。
 */
function applyCompositeStructure(
  questions: ExtractedQuestion[],
  groups: CompositeGroup[],
): void {
  // 逆序遍历，避免索引偏移
  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g]!;
    // 确保索引有效
    if (group.compositeIdx >= questions.length) continue;

    const composite = questions[group.compositeIdx]!;
    // 标记为 composite 类型
    (composite as { type: QuestionType }).type = 'composite';
    // 收集子题 platform_id 列表
    const subIds: string[] = [];
    for (let i = group.subStart; i <= group.subEnd && i < questions.length; i++) {
      const subQ = questions[i];
      if (subQ) {
        subIds.push(subQ.platform_id);
        // 标记子题的父 composite
        (subQ.context as Record<string, unknown>).parent_composite_id = composite.platform_id;
      }
    }
    // 将子题 ID 列表附在 composite 的 context 中
    (composite.context as Record<string, unknown>).sub_question_ids = subIds;
  }
}

// ============================================================
// 匹配题/连线题提取（待实测验证）
// ============================================================

/**
 * 匹配题（超星 answertype=5）的 DOM 结构参考：
 * - 左列（题干项）: .left li 或 .match-left li
 * - 右列（选项项）: .right li 或 .match-right li
 * - 用户通过每行左侧的 <select> 下拉框选择右侧对应项
 *
 * 提取方式同 buildPlaceholderText:
 * - li 内 <img> 替换为 <<Mn>> 占位符
 * - 收集 LaTeX 源
 * - 返回纯文本或带占位符的文本
 *
 * 待实测验证：需要真实超星连线题页面来确认具体 DOM 路径和 selector。
 * 在确认前，匹配题暂按通用方式（extractOptions）提取选项列表。
 */
