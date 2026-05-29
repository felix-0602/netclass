import type { OrchestratorState } from '../state';

/**
 * Routing node: advance to next task or finish.
 * Increments currentTaskIndex so the loop can continue.
 */
export async function checkDone(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  const nextIdx = state.currentTaskIndex + 1;
  const remaining = state.tasks.filter(
    t => t.status === 'pending' || t.status === 'doable' || t.status === 'assessing',
  ).length;

  return {
    currentTaskIndex: nextIdx,
    phase: nextIdx >= state.tasks.length ? 'done' : 'processing',
    summary: {
      ...state.summary,
      pending: remaining,
    },
  };
}
