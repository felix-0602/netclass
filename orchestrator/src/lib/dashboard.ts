import { OrchestratorState, TaskItem, TaskStatus } from '../state';

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending:    '○',
  assessing:  '◐',
  doable:     '●',
  doing:      '◑',
  skipped:    '─',
  blocked:    '◉',
  completed:  '✓',
  failed:     '✗',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function statusOrder(s: TaskStatus): number {
  const order: Record<TaskStatus, number> = {
    completed: 0, doing: 1, blocked: 2,
    doable: 3, assessing: 4, pending: 5,
    skipped: 6, failed: 7,
  };
  return order[s] ?? 9;
}

/**
 * Terminal progress dashboard.
 * Renders a live-updating view of the orchestrator state.
 */
export class Dashboard {
  private lastRender = 0;
  private minInterval = 500; // throttle renders

  render(state: OrchestratorState): void {
    const now = Date.now();
    if (now - this.lastRender < this.minInterval) return;
    this.lastRender = now;

    const lines: string[] = [];

    // Header
    lines.push('╔══════════════════════════════════════════════╗');
    lines.push('║     Netclass LangGraph Orchestrator v0.1     ║');
    lines.push('╚══════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`Phase: ${state.phase}  |  Elapsed: ${formatDuration(Date.now() - state.startedAt)}`);
    lines.push('');

    // Summary
    const s = state.summary;
    lines.push(`Summary:  Total: ${s.total}  |  Done: ${s.completed}  |  Skip: ${s.skipped}  |  Fail: ${s.failed}  |  Left: ${s.pending}`);
    if (s.mathSkipped > 0) lines.push(`  Math-skipped: ${s.mathSkipped}`);
    lines.push('');

    // Task list (sorted: active first, then pending, then done/skipped)
    const sorted = [...state.tasks].sort((a, b) => statusOrder(a.status) - statusOrder(b.status));
    const visible = sorted.slice(0, 20);

    lines.push('Tasks:');
    for (const t of visible) {
      const icon = STATUS_ICONS[t.status] ?? '?';
      const title = (t.title ?? t.chapterName ?? '?').slice(0, 45).padEnd(45);
      const course = t.courseName ? ` [${t.courseName.slice(0, 12)}]` : '';
      const mathTag = t.mathFormulaCount ? ` math:${t.mathFormulaCount}` : '';
      const skipNote = t.skipReason ? ` (${t.skipReason.slice(0, 40)})` : '';
      const result = t.result?.submitted
        ? ` ${t.result.correctRate}%`
        : '';

      lines.push(`  ${icon} ${title}${course}${mathTag}${result}${skipNote}`);
    }

    if (state.tasks.length > 20) {
      lines.push(`  ... ${state.tasks.length - 20} more tasks`);
    }
    lines.push('');

    // Errors
    if (state.errors.length > 0) {
      lines.push('Recent errors:');
      for (const err of state.errors.slice(-5)) {
        lines.push(`  ! ${err.slice(0, 100)}`);
      }
      lines.push('');
    }

    // Clear and render
    console.clear();
    console.log(lines.join('\n'));
  }

  done(final: OrchestratorState): void {
    this.render(final);
    console.log('\n=== DONE ===');
    console.log(`Completed: ${final.summary.completed}/${final.summary.total}`);
    console.log(`Skipped: ${final.summary.skipped} (${final.summary.mathSkipped} math)`);
    console.log(`Failed: ${final.summary.failed}`);
    console.log(`Duration: ${formatDuration(Date.now() - final.startedAt)}`);
  }
}
