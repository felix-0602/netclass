import type { OrchestratorState } from '../state';
import type { BrowserClient } from '../browser';
import type { ServerClient } from '../server-client';
import { createHash } from 'node:crypto';

// Injected at boot time
let serverInstance: ServerClient | null = null;
export function setServer(srv: ServerClient): void {
  serverInstance = srv;
}

/**
 * Simple SHA-256 hash matching the existing client hash logic.
 * Must match server/src/lib/hash.ts for cache to work.
 */
function hashQuestion(q: {
  platform: string;
  type: string;
  text: string;
  options?: Array<{ label: string; text: string }>;
  tex_spans?: Array<{ placeholder: string; latex: string | null }>;
}): string {
  const opts = (q.options ?? [])
    .map(o => `${o.label}:${o.text}`)
    .sort()
    .join('|');
  const tex = (q.tex_spans ?? [])
    .map(t => `${t.placeholder}:${t.latex ?? ''}`)
    .join('|');
  const input = `${q.platform}|${q.type}|${q.text}|${opts}|${tex}`;
  return createHash('sha256').update(input).digest('hex');
}

export async function executeTask(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const { BrowserClient } = await import('../browser');
  const browser = new BrowserClient();

  const idx = state.currentTaskIndex;
  const task = state.tasks[idx];
  if (!task) return { currentTaskIndex: idx + 1 };

  const updated = [...state.tasks];
  updated[idx] = { ...task, status: 'doing' };

  try {
    // Navigate to task page
    await browser.goto(task.url);
    await new Promise(r => setTimeout(r, 3000));

    // Extract full question data
    const questions = await browser.js<Array<{
      platform_id: string;
      type: string;
      text: string;
      options: Array<{ label: string; text: string }>;
      tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
    }>>(`
      (() => {
        const timuList = document.querySelectorAll('.TiMu');
        return Array.from(timuList).map(el => {
          const answerInput = el.querySelector('input[name^="answer"]');
          const typeInput = el.querySelector('input[name^="answertype"]');
          const typeNum = typeInput ? parseInt(typeInput.value) : -1;
          const typeMap = { 0: 'single', 1: 'multi', 2: 'fill', 3: 'judge', 4: 'essay' };
          const qType = typeMap[typeNum] || 'unknown';

          // Extract text with image placeholders
          const clone = el.querySelector('.Zy_TItle, .timu_title, .mark_title')?.cloneNode(true);
          let text = '';
          if (clone) {
            const imgs = clone.querySelectorAll('img');
            imgs.forEach((img, i) => {
              const placeholder = document.createTextNode('<<M' + (i + 1) + '>>');
              img.replaceWith(placeholder);
            });
            text = clone.textContent?.trim() || '';
          }

          // Extract options
          const optionEls = el.querySelectorAll('.Cy_ulBottom li, .TiMu li, li[data]');
          const options = Array.from(optionEls).map(li => ({
            label: li.querySelector('.num_option')?.textContent?.trim() || li.getAttribute('data') || '',
            text: li.textContent?.trim()?.replace(/^[A-Z]\\s*/, '') || ''
          })).filter(o => o.label && o.text);

          // Extract tex spans
          const texSpans = [];
          const imgs = el.querySelectorAll('img[data-latex], img[data-formula], img.kfformula');
          imgs.forEach((img, j) => {
            const latex = img.getAttribute('data-latex') || img.getAttribute('data-formula') || null;
            texSpans.push({ placeholder: '<<M' + (j + 1) + '>>', latex, image_idx: latex ? null : j });
          });

          return {
            platform_id: answerInput ? answerInput.name.replace('answer', '') : '',
            type: qType,
            text: text,
            options: options,
            tex_spans: texSpans,
          };
        });
      })()
    `);

    let answered = 0;
    let total = questions.length;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text && !q.options.length) continue;

      // Check for math blind spots — skip this question
      const hasBlindSpots = q.tex_spans.some(t => t.latex === null && t.image_idx !== null);
      if (hasBlindSpots && q.type === 'fill') continue;

      const hash = hashQuestion({
        platform: 'chaoxing',
        type: q.type,
        text: q.text,
        options: q.options,
        tex_spans: q.tex_spans,
      });

      // Query server for answer
      let answer: string[] | null = null;
      if (serverInstance) {
        const resp = await serverInstance.getAnswer({
          platform: 'chaoxing',
          hash,
          type: q.type,
          text: q.text,
          options: q.options,
          tex_spans: q.tex_spans,
        });

        if (resp.status === 'hit' && resp.answer) {
          answer = resp.answer.raw;
        }
      }

      if (!answer) continue; // No answer available, skip this question

      // Fill answer in DOM
      if (q.type === 'single' || q.type === 'multi') {
        // Click the correct option by label
        for (const ans of answer) {
          try {
            // Map A→1, B→2, etc.
            const liIdx = ans.charCodeAt(0) - 64; // A=1, B=2...
            await browser.click(
              `.TiMu:nth-of-type(${i + 1}) .Cy_ulBottom li:nth-child(${liIdx})`,
            );
          } catch { /* skip */ }
        }
      } else if (q.type === 'judge') {
        const isTrue = /^(对|true|yes|是|正确|T)$/i.test(answer[0] ?? '');
        const liIdx = isTrue ? 1 : 2;
        try {
          await browser.click(
            `.TiMu:nth-of-type(${i + 1}) li:nth-child(${liIdx})`,
          );
        } catch { /* skip */ }
      } else if (q.type === 'fill' || q.type === 'cloze') {
        // Use UEditor API for fill-in-blanks
        try {
          const fillScript = answer
            .map((ans, j) => `try{UE.instants['ueditorInstant${j + i * 2}'].setContent('${ans.replace(/'/g, "\\'")}');}catch(e){}`)
            .join(';');
          await browser.js(fillScript);
        } catch { /* skip */ }
      }

      answered++;
      // Anti-detection delay
      await new Promise(r => setTimeout(r, 800 + Math.random() * 800));
    }

    // Submit if all answered
    let submitted = false;
    if (answered === total && answered > 0) {
      // Set dialog accept handler
      await browser.dialogAccept('yes');

      // Click submit button
      const submitSelectors = [
        'a.btnSubmit',
        'a.btnSubmit.workBtnIndex',
        'a[onclick*="btnBlueSubmit"]',
        '.btnSubmit',
      ];
      for (const sel of submitSelectors) {
        try {
          const visible = await browser.isVisible(sel);
          if (visible) {
            await browser.click(sel);
            await new Promise(r => setTimeout(r, 2000));
            submitted = true;
            break;
          }
        } catch { /* try next */ }
      }

      // Check for confirmation popup in top document
      if (submitted) {
        await new Promise(r => setTimeout(r, 2000));
        const pageText = await browser.text().catch(() => '');
        if (pageText.includes('批改') || pageText.includes('成绩') || pageText.includes('答案')) {
          submitted = true;
        }
        // Check if blocked by a popup
        if (pageText.includes('提示') && (pageText.includes('未及格') || pageText.includes('重做'))) {
          submitted = false;
        }
      }
    }

    updated[idx] = {
      ...updated[idx],
      status: submitted ? 'completed' : (answered > 0 ? 'blocked' : 'failed'),
      result: {
        answered,
        total,
        correctRate: 0,
        marks: [],
        submitted,
      },
    };

    const newSummary = { ...state.summary };
    if (submitted) {
      newSummary.completed++;
    } else if (answered === 0) {
      newSummary.failed++;
    }
    newSummary.pending = Math.max(0, newSummary.pending - 1);

    return { tasks: updated, summary: newSummary };
  } catch (e) {
    updated[idx] = {
      ...updated[idx],
      status: 'failed',
      skipReason: `Execute error: ${String(e).slice(0, 100)}`,
    };
    return {
      tasks: updated,
      errors: [...state.errors, `execute_task ${task.title}: ${String(e)}`],
      summary: { ...state.summary, failed: state.summary.failed + 1 },
    };
  }
}
