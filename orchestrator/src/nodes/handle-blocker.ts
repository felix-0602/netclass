import type { OrchestratorState } from '../state';
import type { BrowserClient } from '../browser';
import type { DeepSeekBrain } from '../lib/deepseek-brain';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Injected at boot time
let brainInstance: DeepSeekBrain | null = null;
export function setBrain(brain: DeepSeekBrain): void {
  brainInstance = brain;
}

export async function handleBlocker(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();

  const idx = state.currentTaskIndex;
  const task = state.tasks[idx];
  if (!task) return { currentTaskIndex: idx + 1 };

  const updated = [...state.tasks];

  try {
    // Take a screenshot for AI analysis
    const screenshotPath = join(tmpdir(), `netclass-blocker-${task.id}.png`);
    await browser.screenshot(screenshotPath);

    // Get page text for analysis
    const pageUrl = await browser.url();
    const pageText = await browser.text().catch(() => '');

    // AI analyzes the popup
    if (brainInstance) {
      const analysis = await brainInstance.analyzePopup({
        taskTitle: task.title,
        pageUrl,
        pageText,
      });

      if (analysis.action === 'click_confirm' && analysis.selector) {
        try {
          await browser.click(analysis.selector);
          await new Promise(r => setTimeout(r, 3000));

          // Re-check: did submission go through?
          const newUrl = await browser.url();
          const newText = await browser.text().catch(() => '');

          if (
            newText.includes('批改') ||
            newText.includes('成绩') ||
            newText.includes('答案') ||
            newUrl !== pageUrl
          ) {
            // Success! Retry execution to verify results
            updated[idx] = { ...task, status: 'doable' };
            return { tasks: updated };
          }
        } catch { /* click failed */ }
      }

      if (analysis.action === 'no_action') {
        // Nothing to do — probably already submitted
        updated[idx] = {
          ...task,
          status: 'completed',
          result: { ...task.result!, submitted: true, answered: task.result?.answered ?? 0, total: task.result?.total ?? 0, correctRate: 0, marks: [] },
        };
        return { tasks: updated };
      }
    }

    // If we can't resolve, give up
    updated[idx] = {
      ...task,
      status: 'failed',
      skipReason: '弹窗无法自动处理，请手动操作',
    };

    return {
      tasks: updated,
      errors: [...state.errors, `handle_blocker ${task.title}: 弹窗未解决`],
      summary: { ...state.summary, failed: state.summary.failed + 1 },
    };
  } catch (e) {
    updated[idx] = {
      ...task,
      status: 'failed',
      skipReason: `Blocker error: ${String(e).slice(0, 100)}`,
    };
    return {
      tasks: updated,
      errors: [...state.errors, `handle_blocker ${task.title}: ${String(e)}`],
      summary: { ...state.summary, failed: state.summary.failed + 1 },
    };
  }
}
