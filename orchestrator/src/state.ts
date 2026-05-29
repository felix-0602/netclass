/** Task lifecycle status */
export type TaskStatus =
  | 'pending'
  | 'assessing'
  | 'doable'
  | 'skipped'
  | 'doing'
  | 'blocked'
  | 'completed'
  | 'failed';

/** Brief question preview for assessment */
export interface QuestionBrief {
  index: number;
  type: string;
  hasTexSpans: boolean;
  hasBlindSpots: boolean;
}

/** Result from executing a task */
export interface TaskResult {
  answered: number;
  total: number;
  correctRate: number;
  marks: Array<{ hash: string; correct: boolean }>;
  submitted: boolean;
}

/** A single task discovered during enumeration */
export interface TaskItem {
  id: string;
  courseId: string;
  courseName: string;
  chapterName: string;
  title: string;
  url: string;
  status: TaskStatus;
  skipReason?: string;
  questionCount?: number;
  mathFormulaCount?: number;
  questions?: QuestionBrief[];
  result?: TaskResult;
}

/** A course discovered during scanning */
export interface Course {
  id: string;
  name: string;
  url: string;
}

/** Phase of the orchestrator */
export type Phase =
  | 'idle'
  | 'scanning-courses'
  | 'enumerating-tasks'
  | 'processing'
  | 'done'
  | 'error';

export interface Summary {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  pending: number;
  mathSkipped: number;
}

export interface OrchestratorState {
  phase: Phase;
  courses: Course[];
  tasks: TaskItem[];
  currentTaskIndex: number;
  currentCourseIndex: number;
  summary: Summary;
  errors: string[];
  startedAt: number;
}

export function createInitialState(): OrchestratorState {
  return {
    phase: 'idle',
    courses: [],
    tasks: [],
    currentTaskIndex: 0,
    currentCourseIndex: 0,
    summary: { total: 0, completed: 0, skipped: 0, failed: 0, pending: 0, mathSkipped: 0 },
    errors: [],
    startedAt: Date.now(),
  };
}
