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
  // 提题干区（含图片）
  const titleArea = timu.querySelector<HTMLElement>('.Zy_TItle .font-cxsecret, .Zy_TItle');
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

  // 题型：从 answertypeXXX 值解析（0/1/2/3/4）
  const rawType = answerTypeInput?.value?.trim() ?? '0';
  const qtype: QuestionType = QTYPE_MAP[rawType] ?? 'single';

  // 占位符化题干：每个 <img> 替换为 <<Mn>>，同时收集图片 URL 和 LaTeX（若带 data 属性）
  const images: string[] = [];
  const texSpans: TexSpan[] = [];
  const text = buildPlaceholderText(titleArea, images, texSpans);

  // 选项：`.Zy_ulTop > li`
  const options = extractOptions(timu, images, texSpans);

  return {
    platform_id: platformId,
    platform: 'chaoxing',
    type: qtype,
    text,
    options,
    tex_spans: texSpans,
    images,
    context: extractContext(timu),
    answer_target: {
      answer_input_name: answerInput.name,
      answer_type_input_name: answerTypeInput?.name,
    },
  };
}

/**
 * 把容器内的 `<img>` 替换为 `<<Mn>>` 占位符，返回纯文本。
 * 同时把图片 src 加入 images[]、LaTeX 数据加入 texSpans[]。
 *
 * LaTeX 提取：超星在 `<img class="ans-latex-moudle" data="%22y%27%20%3D%202x%22">` 里
 * 用 URL-encoded 字符串保存原始 LaTeX 源——直接 decode 即可，省去 vision。
 */
function buildPlaceholderText(
  container: HTMLElement,
  images: string[],
  texSpans: TexSpan[],
): string {
  // 先克隆，避免改原 DOM
  const clone = container.cloneNode(true) as HTMLElement;

  // 清掉题号 label / "【单选题】" 这些 inner span 以便题干更干净（可选：保留以增加上下文）
  // 这里保留，一致性更好；归一化交给 server 的 hash 前置步骤。

  const imgs = clone.querySelectorAll('img');
  imgs.forEach((img) => {
    const src = img.getAttribute('src') ?? img.getAttribute('data-original') ?? '';
    const idx = images.length;
    images.push(src);

    // LaTeX 源：优先 data 属性（URL-encoded 双引号包裹）
    let latex: string | null = null;
    const rawData = img.getAttribute('data');
    if (rawData) {
      try {
        const decoded = decodeURIComponent(rawData);
        // 去掉外层双引号
        latex = decoded.replace(/^"|"$/g, '') || null;
      } catch {
        latex = null;
      }
    }

    const placeholder = `<<M${idx + 1}>>`;
    texSpans.push({ placeholder, latex, image_idx: idx });

    const holder = clone.ownerDocument.createTextNode(placeholder);
    img.parentNode?.replaceChild(holder, img);
  });

  return (clone.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function extractOptions(
  timu: HTMLElement,
  images: string[],
  texSpans: TexSpan[],
): QuestionOption[] {
  const lis = timu.querySelectorAll<HTMLElement>('.Zy_ulTop > li');
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

      let latex: string | null = null;
      const rawData = img.getAttribute('data');
      if (rawData) {
        try {
          latex = decodeURIComponent(rawData).replace(/^"|"$/g, '') || null;
        } catch {
          latex = null;
        }
      }

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

  return ctx;
}

function extractFromUrl(url: string, re: RegExp): string | undefined {
  const m = url.match(re);
  return m?.[1];
}
