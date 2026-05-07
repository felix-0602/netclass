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

export async function callDeepSeek(
  input: DeepSeekInput,
  apiKey: string,
): Promise<AnswerValue | null> {
  if (!apiKey) return null;
  if (input.type === 'essay') return null; // 主观题跳过

  const prompt = buildPrompt(input);
  if (!prompt) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

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
          { role: 'system', content: '你是一个高等数学助教。只输出答案，不要解释。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? '';
    return parseAnswer(raw, input.type);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(input: DeepSeekInput): string {
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

  switch (input.type) {
    case 'single':
      return out + '\n请只回复正确答案的字母（A/B/C/D），不要解释。';
    case 'multi':
      return out + '\n请只回复所有正确答案的字母，用逗号分隔（如 A,C），不要解释。';
    case 'judge':
      return out + '\n请只回复"对"或"错"，不要解释。';
    case 'fill':
      return out + '\n请只回复填空的答案文本，不要解释。';
    default:
      return out;
  }
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
      return { value: clean, raw: [clean] };
    }
    default:
      return null;
  }
}
