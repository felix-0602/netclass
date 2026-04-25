import type { ExtractedQuestionLike } from './types';
import { sha256Hex } from './auth';

export async function hashQuestion(q: ExtractedQuestionLike): Promise<string> {
  const normText = normalize(q.text);
  // chaoxing 实测会 shuffle options 顺序（同一题 A/B/C/D 文本对调位置）— 必须按 label
  // 排序后再拼，否则同题不同 hash → 题库永远 miss。这是 v2 hash 的核心改动。
  const normOpts = [...q.options]
    .sort((a, b) => a.label.localeCompare(b.label))
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
