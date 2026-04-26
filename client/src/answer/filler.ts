// 主编排：提取题目 → 查答案 → 回填 → 统计正确率
//
// 对应旧 app.js:5089-5115 CxQuestionHandler.init 的角色。
//
// 输入：root doc（chaoxing 工作 iframe 的 contentDocument，或用户主动扫描时的 top doc）
// 输出：FillRunSummary { total, answered, pending, errors, unsupported, correctRate }
//
// 每一步都 patchRuntimeState，让 Panel 实时反馈。
// 本层不做 submit —— submit 的阈值判定留给 answer/submit.ts（Phase 1.W2 任务 1.13）。

import { extractQuestionsFromChaoxing } from '../adapters/chaoxing';
import type { ExtractedQuestion } from '../adapters/types';
import { patchRuntimeState } from '../runtime/state';
import { readMarks, submitWork } from '../runtime/work-submit';
import { blobToBase64, composeQuestionImage, type ImgRef } from '../vision/compose';
import { cacheGet } from './cache';
import { getAnswer } from './client';
import { fillBlank } from './fill/blank';
import { fillChoice } from './fill/choice';
import { fillEssay } from './fill/essay';
import { fillJudge } from './fill/judge';
import type { FillContext, FillResult } from './fill/types';
import { hashQuestion } from './hash';

export interface FillRunSummary {
  total: number;
  answered: number; // 成功填上（含 skipped）
  pending: number; // 服务端队列里
  errors: number;
  unsupported: number;
  correctRate: number; // 0-100，answered/total*100
  durationMs: number;
}

export interface RunFillerOptions {
  /** 答题之间的随机延迟区间，反检测用，默认 [800, 1600] ms */
  interDelayMs?: [number, number];
  /** 最多处理前 N 题，避免一次打一大波 /answer，默认 Infinity */
  maxQuestions?: number;
  /** 相似度兜底开关，默认 true */
  useSimilarity?: boolean;
  /** 若为 false，模拟走一遍（只查答案不点击），默认 true */
  actuallyFill?: boolean;
  /**
   * 全部填完后是否自动提交 chaoxing + 读批改结果回写 server。默认 false（用户手动决定）。
   * 章节测验通常多次重做安全开；考试单次提交慎用。
   */
  autoSubmit?: boolean;
}

/**
 * 跑一遍当前页面的答题闭环。
 * 外层通常是：adapter 检测到题目页 iframe → 调用这个函数。
 */
export async function runFiller(
  rootDoc: Document,
  opts: RunFillerOptions = {},
): Promise<FillRunSummary> {
  const {
    interDelayMs = [800, 1600],
    maxQuestions = Infinity,
    useSimilarity = true,
    actuallyFill = true,
  } = opts;

  const startedAt = Date.now();

  patchRuntimeState({
    status: 'working',
    phase: 'extract',
    message: '正在提取题目',
    detected: 0,
    answered: 0,
    pending: 0,
    errors: 0,
    unsupported: 0,
    lastRunAt: startedAt,
  });

  // 抑制页面 alert（填答案时常有"确认提交"之类的弹窗）
  const restoreAlert = suppressAlerts(rootDoc);

  try {
    // 1. 提取题目
    const questions = extractQuestionsFromChaoxing(rootDoc).slice(
      0,
      Number.isFinite(maxQuestions) ? (maxQuestions as number) : undefined,
    );

    patchRuntimeState({ detected: questions.length });

    if (questions.length === 0) {
      patchRuntimeState({
        status: 'idle',
        phase: 'idle',
        message: '当前页面未提取到题目',
      });
      return emptySummary(startedAt);
    }

    // 2. 逐题查答案 + 回填
    const summary: FillRunSummary = {
      total: questions.length,
      answered: 0,
      pending: 0,
      errors: 0,
      unsupported: 0,
      correctRate: 0,
      durationMs: 0,
    };

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      patchRuntimeState({
        phase: `answer ${i + 1}/${questions.length}`,
        message: truncate(q.text, 40),
      });

      try {
        const hash = await hashQuestion(q);

        // 数学题闭环：本地未命中 + 含图片公式 → 合图 + base64 一次性发上去
        // 已命中就跳过 compose（compose 慢，5-15s/题）
        let composite_image_b64: string | undefined;
        const cached = cacheGet(hash);
        if (!cached && needsCompose(q)) {
          patchRuntimeState({
            phase: `compose ${i + 1}/${questions.length}`,
            message: `合成 ${q.images.length} 张公式图`,
          });
          try {
            composite_image_b64 = await composeAndEncode(q);
          } catch (e) {
            // compose 失败仍尝试发文本，让服务端 pending 至少有 metadata。
            // 但**必须**让用户在 Panel 看到（之前 W3+ silent catch 把 @connect 缺域名的事吞了 3 周）
            const reason = (e as Error).message?.slice(0, 60) || 'unknown';
            console.warn('[netclass-sidekick/filler] compose failed:', e);
            patchRuntimeState({
              message: `⚠ 合图失败（${reason}） — 题进 pending 但无图`,
            });
          }
        }

        const resp = await getAnswer({
          platform: q.platform,
          question_id: q.platform_id,
          hash,
          type: q.type,
          text: q.text,
          options: q.options,
          tex_spans: q.tex_spans,
          context: q.context,
          composite_image_b64,
        });

        if (resp.status === 'hit') {
          if (actuallyFill) {
            const res = fillQuestion(rootDoc, q, resp.answer.raw, { useSimilarity });
            if (res.status === 'filled' || res.status === 'skipped') {
              summary.answered++;
            } else if (res.status === 'partial') {
              summary.answered++; // 算填上
            } else if (res.status === 'unsupported') {
              summary.unsupported++;
            } else {
              summary.errors++;
            }
          } else {
            summary.answered++;
          }
        } else if (resp.status === 'pending') {
          summary.pending++;
        } else {
          summary.errors++;
        }
      } catch (e) {
        summary.errors++;
        console.warn('[netclass-sidekick/filler] q error:', e);
      }

      patchRuntimeState({
        answered: summary.answered,
        pending: summary.pending,
        errors: summary.errors,
        unsupported: summary.unsupported,
      });

      // 间隔延迟（除最后一题）
      if (i < questions.length - 1) {
        const delay =
          interDelayMs[0] +
          Math.floor(Math.random() * (interDelayMs[1] - interDelayMs[0]));
        await sleep(delay);
      }
    }

    summary.correctRate =
      summary.total > 0 ? Math.round((summary.answered / summary.total) * 100) : 0;
    summary.durationMs = Date.now() - startedAt;

    patchRuntimeState({
      status: summary.errors > 0 ? 'error' : 'idle',
      phase: 'done',
      message: `完成：${summary.answered}/${summary.total}${summary.pending > 0 ? `，${summary.pending} 待` : ''}${summary.errors > 0 ? `，${summary.errors} 错` : ''}`,
    });

    // 4. autoSubmit：必须**全部题都答上**才提交。缺一道就跳过本节，避免提交不及格 +
    //    chaoxing 弹"未到及格线请重做"的二次门槛。少答的题留着，下次同 hash 命中就能完整答。
    if (opts.autoSubmit) {
      const incomplete = summary.total - summary.answered;
      if (incomplete > 0) {
        patchRuntimeState({
          phase: 'skipped',
          message: `⏭ 跳过提交：${incomplete}/${summary.total} 题没答（题库不全），等下次有答案再交`,
        });
        console.info(
          `[netclass-sidekick/filler] skip submit: ${incomplete} unanswered (pending=${summary.pending} errors=${summary.errors} unsupported=${summary.unsupported})`,
        );
      } else if (summary.answered === 0) {
        // 防御：理论上 incomplete>0 已涵盖，这里二次保护
        patchRuntimeState({ message: '⏭ 跳过提交：0 题答上' });
      } else {
        patchRuntimeState({ phase: 'submit', message: '✅ 题全答完，提交到 chaoxing' });
        const sr = await submitWork(rootDoc);
        if (sr.status === 'submitted') {
          patchRuntimeState({ message: '已提交，等批改...' });
          await sleep(4000); // 给 chaoxing 4s 渲染批改 marker
          const marks = readMarks(rootDoc);
          const correct = marks.filter((m) => m.correct === 'correct').length;
          const wrong = marks.filter((m) => m.correct === 'wrong').length;
          const unknown = marks.filter((m) => m.correct === 'unknown').length;
          patchRuntimeState({
            phase: 'graded',
            message: `批改：✓${correct} ✗${wrong} ?${unknown}`,
          });
          // marks 暴露给 console，方便实测验证 marker selector 是否对
          console.info('[netclass-sidekick/filler] chaoxing marks:', marks.map((m) => ({
            input: m.inputName, correct: m.correct, evidence: m.evidence,
          })));
        } else {
          patchRuntimeState({ message: `⚠ 提交失败：${sr.status}` });
        }
      }
    }

    return summary;
  } finally {
    restoreAlert();
  }
}

/**
 * 判断是否需要合图：题目里有图片公式（tex_spans 里 image_idx 非空 + 对应图片 url 存在）。
 * 纯文本题 / 已有 LaTeX 源的题 不走 compose（节省 5-15 秒/题）。
 */
function needsCompose(q: ExtractedQuestion): boolean {
  if (!q.images || q.images.length === 0) return false;
  // 至少有一个 tex_span 是"无 latex 源 + 有 image_idx"，意味着公式只能靠图识别
  return q.tex_spans.some((t) => t.latex === null && t.image_idx !== null);
}

/** 把题目里所有公式图按 stem/option 角色组织成 ImgRef[]，调 vision/compose 合一张 */
async function composeAndEncode(q: ExtractedQuestion): Promise<string> {
  const refs = buildImgRefs(q);
  if (refs.length === 0) {
    throw new Error('needsCompose=true but no usable image refs');
  }
  const blob = await composeQuestionImage(refs);
  return await blobToBase64(blob);
}

function buildImgRefs(q: ExtractedQuestion): ImgRef[] {
  // 选项 placeholder → 选项 label 的反查表
  const optionPlaceholders = new Map<string, string>();
  for (const o of q.options) {
    if (o.image_ref) optionPlaceholders.set(o.image_ref, o.label);
  }
  const refs: ImgRef[] = [];
  for (const span of q.tex_spans) {
    if (span.image_idx == null) continue;
    const url = q.images[span.image_idx];
    if (!url) continue;
    const optLabel = optionPlaceholders.get(span.placeholder);
    refs.push({
      url,
      role: optLabel ? 'option' : 'stem',
      label: optLabel,
    });
  }
  return refs;
}

/** 按题型派发到正确的 fill handler */
function fillQuestion(
  rootDoc: Document,
  q: ExtractedQuestion,
  answers: string[],
  opts: { useSimilarity: boolean },
): FillResult {
  const timu = findTiMuByAnswerInputName(rootDoc, q.answer_target.answer_input_name);
  if (!timu) {
    return {
      status: 'error',
      message: `找不到 TiMu 元素（answer_input_name=${q.answer_target.answer_input_name}）`,
    };
  }
  const ctx: FillContext = { timu, doc: timu.ownerDocument ?? rootDoc };
  switch (q.type) {
    case 'single':
    case 'multi':
      return fillChoice(ctx, answers, { useSimilarity: opts.useSimilarity });
    case 'judge':
      return fillJudge(ctx, answers);
    case 'fill':
      return fillBlank(ctx, answers);
    case 'essay':
      return fillEssay(ctx, answers);
    default:
      return { status: 'unsupported', message: `未知题型 ${q.type}` };
  }
}

/** 按 hidden input name 反查 TiMu 容器（所有 fill handler 都吃 .TiMu） */
function findTiMuByAnswerInputName(
  rootDoc: Document,
  name: string | undefined,
): HTMLElement | null {
  if (!name) return null;
  // 递归扫所有同源 iframe
  const stack: Array<Document | ShadowRoot> = [rootDoc];
  while (stack.length > 0) {
    const d = stack.pop()!;
    if ((d as Document).querySelector) {
      const input = (d as Document).querySelector<HTMLInputElement>(
        `input[name="${cssEscape(name)}"]`,
      );
      if (input) return input.closest<HTMLElement>('.TiMu');
    }
    if ((d as Document).querySelectorAll) {
      (d as Document).querySelectorAll('iframe').forEach((frame) => {
        try {
          const inner = (frame as HTMLIFrameElement).contentDocument;
          if (inner) stack.push(inner);
        } catch {
          // cross-origin
        }
      });
    }
  }
  return null;
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function suppressAlerts(rootDoc: Document): () => void {
  const win = rootDoc.defaultView;
  if (!win) return () => {};
  const origAlert = win.alert;
  const origConfirm = win.confirm;
  try {
    win.alert = () => {};
    win.confirm = () => true;
  } catch {
    return () => {};
  }
  return () => {
    try {
      win.alert = origAlert;
      win.confirm = origConfirm;
    } catch {
      // ignore
    }
  };
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function emptySummary(startedAt: number): FillRunSummary {
  return {
    total: 0,
    answered: 0,
    pending: 0,
    errors: 0,
    unsupported: 0,
    correctRate: 0,
    durationMs: Date.now() - startedAt,
  };
}
