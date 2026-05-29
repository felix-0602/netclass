import type { OrchestratorState } from '../state';
import type { BrowserClient } from '../browser';
import { detectMathFormulas, shouldSkipForMath } from '../lib/math-detector';
import type { DeepSeekBrain } from '../lib/deepseek-brain';

// Injected at boot time
let brainInstance: DeepSeekBrain | null = null;
export function setBrain(brain: DeepSeekBrain): void {
  brainInstance = brain;
}

export async function assessTask(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();

  const idx = state.currentTaskIndex;
  const task = state.tasks[idx];
  if (!task) {
    return { currentTaskIndex: idx + 1 };
  }

  const updated = [...state.tasks];
  updated[idx] = { ...task, status: 'assessing' };

  try {
    // Navigate to task page to extract questions
    await browser.goto(task.url);
    await new Promise(r => setTimeout(r, 2000));

    // Extract question metadata via DOM
    const questions = await browser.js<Array<{
      index: number;
      type: string;
      tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
    }>>(`
      (() => {
        const timuList = document.querySelectorAll('.TiMu');
        return Array.from(timuList).map((el, i) => {
          const typeInput = el.querySelector('input[name^="answertype"]');
          const typeNum = typeInput ? parseInt(typeInput.value) : -1;
          const typeMap = { 0: 'single', 1: 'multi', 2: 'fill', 3: 'judge', 4: 'essay' };
          const qType = typeMap[typeNum] || 'unknown';

          // Detect LaTeX spans (simplified)
          const texSpans = [];
          const imgs = el.querySelectorAll('img[data-latex], img[data-formula]');
          imgs.forEach((img, j) => {
            const latex = img.getAttribute('data-latex') || img.getAttribute('data-formula') || null;
            texSpans.push({
              placeholder: '<<M' + (j + 1) + '>>',
              latex: latex,
              image_idx: latex ? j : j
            });
          });

          return { index: i + 1, type: qType, tex_spans: texSpans };
        });
      })()
    `);

    // Run math detection
    const allTexSpans = questions.flatMap(q => q.tex_spans);
    const mathResult = detectMathFormulas(allTexSpans);
    const skipCheck = shouldSkipForMath(mathResult);

    const questionTypes = [...new Set(questions.map(q => q.type))];

    let status = 'doable';
    let skipReason: string | undefined;

    if (skipCheck.skip) {
      status = 'skipped';
      skipReason = skipCheck.reason;
    } else if (brainInstance) {
      const decision = await brainInstance.assessTask({
        title: task.title,
        questionCount: questions.length,
        mathResult,
        questionTypes,
      });
      if (!decision.doable) {
        status = 'skipped';
        skipReason = decision.reason;
      }
    }

    updated[idx] = {
      ...updated[idx],
      status: status as 'doable' | 'skipped',
      skipReason,
      questionCount: questions.length,
      mathFormulaCount: mathResult.formulaCount,
      questions: questions.map(q => ({
        index: q.index,
        type: q.type,
        hasTexSpans: q.tex_spans.length > 0,
        hasBlindSpots: q.tex_spans.some(t => t.latex === null),
      })),
    };

    const newSummary = { ...state.summary };
    if (status === 'skipped') {
      newSummary.skipped++;
      if (mathResult.hasMath) newSummary.mathSkipped++;
    }

    return { tasks: updated, summary: newSummary };
  } catch (e) {
    updated[idx] = {
      ...updated[idx],
      status: 'failed',
      skipReason: `Assess error: ${String(e).slice(0, 100)}`,
    };
    return {
      tasks: updated,
      errors: [...state.errors, `assess_task ${task.title}: ${String(e)}`],
      summary: { ...state.summary, failed: state.summary.failed + 1 },
    };
  }
}
