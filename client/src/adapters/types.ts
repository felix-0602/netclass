// 平台无关的题目数据模型。任何 adapter 提取出的题都归一到这里。

export type QuestionType = 'single' | 'multi' | 'judge' | 'fill' | 'essay' | 'cloze' | 'matching' | 'composite';

export interface TexSpan {
  /** 占位符，如 "<<M1>>"，插入在 text 和 options 里 */
  placeholder: string;
  /** 若平台提供 LaTeX 源码就写入；超星图片题目为 null */
  latex: string | null;
  /** 对应 images 数组里的索引 */
  image_idx: number | null;
}

export interface QuestionOption {
  label: string; // "A" | "B" | ...
  text: string | null; // 纯文本时非空
  image_ref: string | null; // 指向 images[i] 的占位符
}

export interface ExtractedQuestion {
  /** 平台内部 ID（超星 questionId；U校园可自派生） */
  platform_id: string;
  platform: 'chaoxing' | 'zhihuishu' | 'unipus';
  type: QuestionType;
  /** 解混淆后的题干，含 <<Mx>> 占位符 */
  text: string;
  options: QuestionOption[];
  tex_spans: TexSpan[];
  /** 原图 URL 列表（若有） */
  images: string[];
  /** 课程/章节上下文 */
  context: {
    course_id?: string;
    clazz_id?: string;
    knowledge_id?: string;
    work_id?: string;
    course_name?: string;
    raw_question_type?: string;
  };
  /** 指向 DOM 里的 answer input 元素，填答案时用 */
  answer_target: {
    answer_input_name?: string;
    answer_type_input_name?: string;
  };
}
