// Server-side 共用类型定义

export interface ExtractedQuestionLike {
  platform: 'chaoxing' | 'zhihuishu' | 'unipus';
  type: 'single' | 'multi' | 'judge' | 'fill' | 'essay';
  text: string;
  options: Array<{ label: string; text: string | null; image_ref: string | null }>;
  tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
}

export interface AnswerValue {
  value: string; // 'D' | 'A,C' | 'true' | '答案文本'
  raw: string[]; // 机器友好格式 ['D'] / ['A','C']
}

export interface QuestionRow {
  id: string;
  platform: string;
  q_type: string;
  text: string;
  options_json: string;
  tex_spans_json: string;
  image_key: string | null;
  course_sig: string | null;
  answer_json: string;
  confidence: number;
  source: string;
  verified_by: string | null;
  hit_count: number;
  first_seen: number;
  last_hit: number | null;
  created_at: number;
}

export interface PendingRow {
  id: string;
  platform: string;
  q_type: string;
  text: string;
  options_json: string;
  tex_spans_json: string;
  image_key: string | null;
  context_json: string | null;
  priority: number;
  attempts: number;
  submitted_by: string | null;
  needs_vision: number;
  created_at: number;
}
