import { reactive } from 'vue';

export type RuntimeStatus = 'idle' | 'working' | 'error';

/** 单题的处理结局 — 让 Panel 能区分"缓存命中"vs"刚入队"vs"失败" */
export type QuestionTriageOutcome =
  | 'unknown'                // 还没轮到
  | 'hit-cache'              // 本地 LRU 命中，零延迟
  | 'hit-server'             // 服务端命中，会写入 LRU
  | 'pending-newly-queued'   // 第一次见，已上传服务端，几分钟后入库
  | 'unsupported'            // 题型不支持
  | 'error';                 // 真错

/** 整节的状态总览 — 扫描后 banner 的核心 */
export type SectionTriageState =
  | 'unknown'           // 还没扫 / 还没分类
  | 'all-ready'         // 全部本地命中或服务端命中，可直接做
  | 'mixed'             // 部分本地命中、剩余要问服务端（运行中）
  | 'partial-pending'   // 答完后：部分命中 + 部分新入队
  | 'all-pending';      // 答完后：全部新入队，本节这次做不了

export interface RuntimeLogEvent {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'err' | 'ok';
  text: string;
}

export interface RuntimeQuestionState {
  index: number;            // 1-based，给 UI 显示
  preview: string;          // 题干前 30-40 字
  outcome: QuestionTriageOutcome;
}

export interface RuntimeSectionTriage {
  state: SectionTriageState;
  total: number;
  readyLocal: number;       // cacheGet 命中数
  needsServer: number;      // 需要打服务端的题数
  pending: number;          // 跑完后的新入队数（运行中是 0）
  errors: number;
  computedAt: number | null;
}

export interface RuntimeState {
  status: RuntimeStatus;
  automationEnabled: boolean;
  phase: string;
  message: string;          // 保留：当前正在做的一句话（不再是历史载体）
  sectionTitle: string;     // 章节名，header 显示

  detected: number;
  answered: number;
  pending: number;
  unsupported: number;
  errors: number;

  questions: RuntimeQuestionState[];   // 每题分类，按 index 累加
  sectionTriage: RuntimeSectionTriage; // 整节状态
  logs: RuntimeLogEvent[];             // 控制台滚动条，最多 50 条

  lastRunAt: number | null;     // 本次 run 起点
  lastSuccessAt: number | null; // 最近一次成功答出题 / 提交成功的时刻
  lastSubmitAt: number | null;  // 最近一次走到 chaoxing 提交
}

export interface RuntimeActions {
  manualScan?: () => void;
  toggleAutomation?: (enabled: boolean) => void;
  startCourse?: () => void;
  stopCourse?: () => void;
}

const MAX_LOGS = 50;

function emptyTriage(): RuntimeSectionTriage {
  return {
    state: 'unknown',
    total: 0,
    readyLocal: 0,
    needsServer: 0,
    pending: 0,
    errors: 0,
    computedAt: null,
  };
}

export const runtimeState = reactive<RuntimeState>({
  status: 'idle',
  automationEnabled: true,
  phase: 'boot',
  message: '等待页面就绪',
  sectionTitle: '',

  detected: 0,
  answered: 0,
  pending: 0,
  unsupported: 0,
  errors: 0,

  questions: [],
  sectionTriage: emptyTriage(),
  logs: [],

  lastRunAt: null,
  lastSuccessAt: null,
  lastSubmitAt: null,
});

let actions: RuntimeActions = {};
let logSeq = 0;

export function patchRuntimeState(patch: Partial<RuntimeState>): void {
  Object.assign(runtimeState, patch);
}

/** 控制台 push 一条日志，自动截到 MAX_LOGS。和 message 互不影响 */
export function addRuntimeLog(level: RuntimeLogEvent['level'], text: string): void {
  runtimeState.logs.push({ id: ++logSeq, ts: Date.now(), level, text });
  // 仅当超长时截一次，避免每次 push 都 splice
  if (runtimeState.logs.length > MAX_LOGS) {
    runtimeState.logs.splice(0, runtimeState.logs.length - MAX_LOGS);
  }
}

/** 一次扫描开始：清掉 per-run 字段，但保留 lastSuccessAt 这种跨 run 信号 */
export function resetRuntimeForRun(): void {
  runtimeState.questions = [];
  runtimeState.sectionTriage = emptyTriage();
  runtimeState.detected = 0;
  runtimeState.answered = 0;
  runtimeState.pending = 0;
  runtimeState.unsupported = 0;
  runtimeState.errors = 0;
}

export function setSectionTriage(triage: Partial<RuntimeSectionTriage>): void {
  Object.assign(runtimeState.sectionTriage, triage, { computedAt: Date.now() });
}

export function recordQuestionOutcome(index: number, outcome: QuestionTriageOutcome): void {
  const q = runtimeState.questions[index];
  if (q) q.outcome = outcome;
}

export function markSuccess(): void {
  runtimeState.lastSuccessAt = Date.now();
}

export function markSubmit(): void {
  runtimeState.lastSubmitAt = Date.now();
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

export function requestStartCourse(): void {
  actions.startCourse?.();
}

export function requestStopCourse(): void {
  actions.stopCourse?.();
}
