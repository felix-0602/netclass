// DeepSeek API 客户端 —— 服务端 /answer 实时作答
// 缓存未命中时直接调 DeepSeek，失败返回 null → 回退 pending_q

import type { AnswerValue } from './types';

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const API_TIMEOUT_MS = 10_000;

export interface DeepSeekInput {
  type: 'single' | 'multi' | 'judge' | 'fill' | 'essay';
  text: string;
  options: Array<{ label: string; text: string | null; image_ref: string | null }>;
  tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
}

function buildSystemPrompt(type: DeepSeekInput['type'], retry?: boolean): string {
  const basePrompt = '你是一个高等数学助教。';

  const typeInstructions: Record<DeepSeekInput['type'], string> = {
    single: '仔细分析每个选项，选择最准确的答案。只输出正确答案的字母（A/B/C/D），不要解释。',
    multi: '仔细分析每个选项，选择所有正确答案。只输出所有正确答案的字母，用逗号分隔（如 A,C），不要解释。',
    judge: '严格判断下列命题是否正确。只输出"对"或"错"，不要解释。',
    fill: '仔细计算，注意数值格式和精确匹配。只输出答案，多个空用 || 分隔，不要解释。',
    essay: '给出完整的解答过程，使用中文回答。直接输出答案内容，不要标注"答案："等前缀，不要评价自己的回答。',
  };

  const retrySuffix = retry
    ? '注意：你之前回答过此题但答案被判定为错误，请重新仔细分析，避免重复错误。'
    : '';

  return `${basePrompt} ${typeInstructions[type]} ${retrySuffix}`.trim();
}

function getTemperature(type: DeepSeekInput['type']): number {
  switch (type) {
    case 'single':
    case 'multi':
    case 'judge':
      return 0.1;
    case 'fill':
      return 0.1;
    case 'essay':
      return 0.3;
    default:
      return 0;
  }
}

function getDifficultyHint(input: DeepSeekInput): string {
  const { type, options, tex_spans } = input;

  switch (type) {
    case 'single':
    case 'multi':
      if (options.length >= 6) {
        return '\n注意：本题选项较多，请仔细辨析每个选项的细节差异。';
      }
      if (options.some((o) => (o.text?.length ?? 0) > 50)) {
        return '\n注意：本题含有较长选项描述，请仔细阅读并分析每个选项。';
      }
      break;
    case 'fill':
      if ((tex_spans ?? []).length >= 3) {
        return '\n注意：本题涉及多个数学公式，请仔细计算，注意符号和格式。';
      }
      break;
  }

  return '';
}

export interface CallResult {
  answer: AnswerValue | null;
  latencyMs: number;
}

export async function callDeepSeek(
  input: DeepSeekInput,
  apiKey: string,
  retry?: boolean,
): Promise<CallResult> {
  if (!apiKey) return { answer: null, latencyMs: 0 };

  const prompt = buildPrompt(input, retry);
  if (!prompt) return { answer: null, latencyMs: 0 };

  const isEssay = input.type === 'essay';
  const maxTokens = isEssay ? 512 : 100;
  const temperature = getTemperature(input.type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), isEssay ? 30_000 : API_TIMEOUT_MS);

  const startedAt = Date.now();
  try {
    const res = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildSystemPrompt(input.type, retry) },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return { answer: null, latencyMs: Date.now() - startedAt };

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? '';
    return { answer: parseAnswer(raw, input.type), latencyMs: Date.now() - startedAt };
  } catch {
    return { answer: null, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(input: DeepSeekInput, retry?: boolean): string {
  const texMap = new Map<string, string>();
  for (const s of input.tex_spans ?? []) {
    if (s.latex) texMap.set(s.placeholder, s.latex.trim());
  }
  const resolveTex = (t: string | null) => {
    if (!t) return '';
    return t.replace(/<<M\d+>>/g, (m) => {
      const lx = texMap.get(m);
      return lx ? `$${lx}$` : m;
    });
  };

  let out = resolveTex(input.text) + '\n';
  for (const o of input.options ?? []) {
    out += `${o.label}. ${resolveTex(o.text)}`;
    if (o.image_ref) out += ` ${resolveTex(o.image_ref)}`;
    out += '\n';
  }

  // difficulty hint based on question structure
  out += getDifficultyHint(input);

  switch (input.type) {
    case 'single':
      out += '\n请只回复正确答案的字母（A/B/C/D），不要解释。';
      break;
    case 'multi':
      out += '\n请只回复所有正确答案的字母，用逗号分隔（如 A,C），不要解释。';
      break;
    case 'judge':
      out += '\n请只回复"对"或"错"，不要解释。';
      break;
    case 'fill':
      out += '\n请只回复填空题的答案。如果有多个空，用 || 分隔（如 答案1||答案2||答案3），不要解释。';
      break;
    case 'essay':
      out += '\n请用中文作答，直接给出答案内容，不要标注"答案："等前缀，不要评价自己的回答。';
      break;
    default:
      return out;
  }

  // retry context for wrong-answer retries
  if (retry) {
    out += '\n注意：你之前对此题的解答被判定为错误，请重新仔细作答。';
  }

  return out;
}

function parseAnswer(raw: string, type: string): AnswerValue | null {
  switch (type) {
    case 'single': {
      const m = raw.match(/[A-D]/);
      if (!m) return null;
      return { value: m[0], raw: [m[0]] };
    }
    case 'multi': {
      const letters = raw.match(/[A-D]/g);
      if (!letters || letters.length === 0) return null;
      const unique = [...new Set(letters)];
      return { value: unique.join(','), raw: unique };
    }
    case 'judge': {
      const cleaned = raw.replace(/[，。！？\s]/g, '');
      if (/^对$|^正确$|^✓$|^true$/i.test(cleaned))
        return { value: 'true', raw: ['true'] };
      if (/^错$|^错误$|^✗$|^false$/i.test(cleaned))
        return { value: 'false', raw: ['false'] };
      return null;
    }
    case 'fill': {
      const clean = raw.replace(/^["'「『]|["'」』]$/g, '').trim();
      if (!clean) return null;
      // 多空分隔符 || → 每个 blank 各自一个 raw 元素
      const parts = clean.split('||').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) return null;
      return { value: clean, raw: parts };
    }
    case 'essay': {
      const clean = raw.replace(/^(答案[：:]\s*|回答[：:]\s*)/i, '').trim();
      if (!clean) return null;
      return { value: clean, raw: [clean] };
    }
    default:
      return null;
  }
}
