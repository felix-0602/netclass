import type { OrchestratorState } from '../state';
import type { BrowserClient } from '../browser';
import type { ServerClient } from '../server-client';
import type { VerifyItem } from '../server-client';

// Injected at boot time
let serverInstance: ServerClient | null = null;
export function setServer(srv: ServerClient): void {
  serverInstance = srv;
}

export async function verifyResult(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();

  const idx = state.currentTaskIndex;
  const task = state.tasks[idx];
  if (!task || !task.result?.submitted) return {};

  const updated = [...state.tasks];

  try {
    // Read grading marks from the page
    const marks = await browser.js<Array<{ index: number; correct: boolean; hash?: string }>>(`
      (() => {
        const correctMarkers = '.marking_dui, .zyberrect, .font_dui, .dui, .mark_right, [class*="correct"], [class*="right"]';
        const wrongMarkers = '.marking_cuo, .zyberror, .font_cuo, .cuo, .mark_wrong, [class*="wrong"], [class*="error"]';
        const results = [];

        document.querySelectorAll('.TiMu, .ans-cc').forEach((el, i) => {
          const hasCorrect = el.querySelector(correctMarkers);
          const hasWrong = el.querySelector(wrongMarkers);
          if (hasCorrect) results.push({ index: i, correct: true });
          else if (hasWrong) results.push({ index: i, correct: false });
        });

        return results;
      })()
    `);

    // Read correct answers from the page for wrong questions
    const correctAnswers = await browser.js<Array<{ index: number; answer: string }>>(`
      (() => {
        const results = [];
        document.querySelectorAll('.TiMu').forEach((el, i) => {
          const correctEl = el.querySelector('.correctAnswer, .answer_detail, .right_ans, [class*="correct_ans"], [class*="rightAnswer"]');
          if (correctEl) {
            results.push({ index: i, answer: correctEl.textContent?.trim() || '' });
          }
        });
        return results;
      })()
    `);

    // Build verify items for server
    const verifyItems: VerifyItem[] = marks.map(m => ({
      hash: `task-${task.id}-q${m.index}`,
      correct: m.correct,
    }));

    if (verifyItems.length > 0 && serverInstance) {
      await serverInstance.verifyResults(verifyItems);
    }

    const correctCount = marks.filter(m => m.correct).length;
    const correctRate = marks.length > 0
      ? Math.round((correctCount / marks.length) * 100)
      : 0;

    updated[idx] = {
      ...task,
      status: 'completed',
      result: {
        ...task.result!,
        correctRate,
        marks: marks.map(m => ({
          hash: `task-${task.id}-q${m.index}`,
          correct: m.correct,
        })),
      },
    };

    const newSummary = { ...state.summary };
    newSummary.completed++;

    return { tasks: updated, summary: newSummary };
  } catch (e) {
    updated[idx] = {
      ...task,
      status: 'completed',
    };
    return {
      tasks: updated,
      errors: [...state.errors, `verify_result ${task.title}: ${String(e)}`],
    };
  }
}
