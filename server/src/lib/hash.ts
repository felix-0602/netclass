import type { ExtractedQuestionLike } from './types';
import { sha256Hex } from './auth';

export async function hashQuestion(q: ExtractedQuestionLike): Promise<string> {
  const normText = normalize(q.text);
  const normOpts = q.options
    .map((o) => `${o.label}:${normalize(o.text ?? o.image_ref ?? '')}`)
    .join('|');
  const normTex = [...q.tex_spans]
    .sort((a, b) => a.placeholder.localeCompare(b.placeholder))
    .map((t) => `${t.placeholder}:${normalizeTex(t.latex ?? '')}`)
    .join('|');
  const key = [q.platform, q.type, normText, normOpts, normTex].join('\n');
  return await sha256Hex(key);
}

function normalize(s: string): string {
  return s.replace(/\u200b|\ufeff|\u00a0/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeTex(s: string): string {
  return s.replace(/\u200b|\ufeff|\u00a0/g, '').replace(/\s+/g, ' ').trim();
}
