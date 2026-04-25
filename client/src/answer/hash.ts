// 客户端题目哈希 —— 必须与 server/src/lib/hash.ts 行为完全一致，否则
// 服务端写答案用 hash H1，客户端下次查用 hash H2，题库永远 miss。
//
// 输入：ExtractedQuestion 的核心字段 (platform, type, text, options, tex_spans)
// 输出：sha256 hex 字符串
//
// 规则（跟 server/src/lib/hash.ts:4 对齐）：
//   key = [platform, type, normText, normOpts, normTex].join('\n')
//   normText = strip ZWSP/BOM/NBSP -> collapse \s+ -> trim -> lowercase
//   normOpts = options.map(label:normalize(text||image_ref||'')).join('|')
//   normTex  = tex_spans.sort(byPlaceholder).map(placeholder:normalizeTex(latex||'')).join('|')
//   normalizeTex same except no lowercase (LaTeX 大小写有意义)

import type { ExtractedQuestion } from '../adapters/types';

type QuestionHashInput = Pick<
  ExtractedQuestion,
  'platform' | 'type' | 'text' | 'options' | 'tex_spans'
>;

const STRIP_CHARS = /[​﻿ ]/g;

export async function hashQuestion(q: QuestionHashInput): Promise<string> {
  const normText = normalize(q.text);
  // chaoxing 实测会 shuffle options 顺序（同题 A/B/C/D 文本对调位置）— 按 label
  // 排序后再拼。必须跟 server/src/lib/hash.ts 一字不差，否则 client/server 算的 hash
  // 不一致，题库永远 miss。
  const normOpts = [...q.options]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `${o.label}:${normalize(o.text ?? o.image_ref ?? '')}`)
    .join('|');
  const normTex = [...q.tex_spans]
    .sort((a, b) => a.placeholder.localeCompare(b.placeholder))
    .map((t) => `${t.placeholder}:${normalizeTex(t.latex ?? '')}`)
    .join('|');
  const key = [q.platform, q.type, normText, normOpts, normTex].join('\n');
  return sha256Hex(key);
}

function normalize(s: string): string {
  return s.replace(STRIP_CHARS, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeTex(s: string): string {
  return s.replace(STRIP_CHARS, '').replace(/\s+/g, ' ').trim();
}

/** 浏览器 crypto.subtle.digest -> hex 字符串 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}
