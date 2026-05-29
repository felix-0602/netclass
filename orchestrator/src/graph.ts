import type { OrchestratorState } from './state';

/**
 * Simple state machine routing — replaces LangGraph dependency.
 * The graph structure is documented here but executed manually in index.ts.
 *
 * Nodes:
 *   scan_courses → enumerate_tasks → assess_task → [doable:execute_task → verify_result] | [skip:next] → check_done
 *   execute_task → [blocked:handle_blocker → retry|give_up] | [completed:verify_result]
 */

export type NodeName =
  | 'scan_courses'
  | 'enumerate_tasks'
  | 'assess_task'
  | 'execute_task'
  | 'verify_result'
  | 'handle_blocker'
  | 'check_done';

export interface GraphNode {
  name: NodeName;
  fn: (state: OrchestratorState) => Promise<Partial<OrchestratorState>>;
}

/**
 * Returns the ordered list of node definitions.
 * The actual execution loop is in index.ts.
 */
export function getNodes(
  nodes: Record<NodeName, (state: OrchestratorState) => Promise<Partial<OrchestratorState>>>,
): GraphNode[] {
  return [
    { name: 'scan_courses', fn: nodes.scan_courses },
    { name: 'enumerate_tasks', fn: nodes.enumerate_tasks },
    { name: 'assess_task', fn: nodes.assess_task },
    { name: 'execute_task', fn: nodes.execute_task },
    { name: 'verify_result', fn: nodes.verify_result },
    { name: 'handle_blocker', fn: nodes.handle_blocker },
    { name: 'check_done', fn: nodes.check_done },
  ];
}
