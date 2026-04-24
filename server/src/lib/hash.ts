// Question hash 生成：把题目归一化后算 sha256，当作 D1 主键

import type { ExtractedQuestionLike } from './types';
import { sha256Hex } from './auth';

/**
 * 归一化题目文本（大小写、空白、换行、占位符标准化），然后 sha256。
 *
 * 为什么这么做：
 *   - 超星字体混淆解完后仍可能有不可见字符（​, ﻿, 额外空格）
 *   - 同一题目在不同账号/设备可能 render 出微差异
 *   - hash 必须稳定才能跨用户复用题库
 */
export async function hashQuestion(q: ExtractedQuestionLike): Promise<string> {
  const normText = normalize(q.text);
  const normOpts = q.options
    .map((o) => `${o.label}:${normalize(o.text ?? o.image_ref ?? '')}`)
    .join('|');
  const normTex = q.tex_spans.map((t) => t.placeholder).join(',');
  const key = [q.platform, q.type, normText, normOpts, normTex].join('\n');
  return await sha256Hex(key);
}

function normalize(s: string): string {
  return s
    .replace(/​|﻿| /g, '') // 零宽 + BOM + 不可见空格
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
