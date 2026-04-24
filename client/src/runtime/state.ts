import { reactive } from 'vue';

export type RuntimeStatus = 'idle' | 'working' | 'error';

export interface RuntimeState {
  status: RuntimeStatus;
  automationEnabled: boolean;
  phase: string;
  message: string;
  detected: number;
  answered: number;
  pending: number;
  unsupported: number;
  errors: number;
  lastRunAt: number | null;
}

export interface RuntimeActions {
  manualScan?: () => void;
  toggleAutomation?: (enabled: boolean) => void;
}

export const runtimeState = reactive<RuntimeState>({
  status: 'idle',
  automationEnabled: true,
  phase: 'boot',
  message: '等待页面就绪',
  detected: 0,
  answered: 0,
  pending: 0,
  unsupported: 0,
  errors: 0,
  lastRunAt: null,
});

let actions: RuntimeActions = {};

export function patchRuntimeState(patch: Partial<RuntimeState>): void {
  Object.assign(runtimeState, patch);
}

export function registerRuntimeActions(next: RuntimeActions): void {
  actions = next;
}

export function requestManualScan(): void {
  actions.manualScan?.();
}

export function setAutomationEnabled(enabled: boolean): void {
  runtimeState.automationEnabled = enabled;
  actions.toggleAutomation?.(enabled);
}
