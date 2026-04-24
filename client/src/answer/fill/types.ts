// fill handler 共用契约
//
// 每个 handler 接收：TiMu 容器 + 服务端返回的 raw 答案数组 + 可选配置
// 返回：状态（filled/partial/unsupported/error/skipped）+ 可选说明

export interface FillContext {
  /** 题目根容器（chaoxing 是 `.TiMu` div；U 校园是 `.question-common-abs-...`） */
  timu: HTMLElement;
  /** 含 window 的 doc —— 用来访问 UEditor 等页面级 API */
  doc: Document;
}

export type FillStatus = 'filled' | 'partial' | 'unsupported' | 'error' | 'skipped';

export interface FillResult {
  status: FillStatus;
  message?: string;
  /** 调试：告诉上层匹配了几个 */
  matched?: number;
  total?: number;
}

export type FillHandler = (
  ctx: FillContext,
  answers: string[],
  opts?: Record<string, unknown>,
) => FillResult;

/** 去 HTML 标签，保留纯文本。用于清洗服务端返回的 answer 字符串 */
export function removeHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 从 chaoxing 选项 `<li>` 里挖出纯文本（剔除 .num_option 标签 + img） */
export function extractChaoxingOptionText(li: HTMLElement): string {
  // 优先 .after / .clearfix.after（选项正文容器）；否则用整个 li
  const container = li.querySelector<HTMLElement>('.after, .clearfix.after') ?? li;
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => img.remove());
  clone.querySelectorAll('.num_option').forEach((el) => el.remove());
  return (clone.textContent ?? '').trim().replace(/\s+/g, ' ');
}

/** 判断 chaoxing 选项是否已选中（aria-checked 或其他平台标记） */
export function isChaoxingOptionSelected(li: HTMLElement): boolean {
  if (li.getAttribute('aria-checked') === 'true') return true;
  // 有些版本用 .check_answer 类名表示已答
  if (li.querySelector('.check_answer, .check_answer_dx')) return true;
  return false;
}
