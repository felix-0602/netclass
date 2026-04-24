// 单选 / 多选题回填
//
// 对应旧 app.js:5131-5177 的 type 0/1 分支。
//
// 策略：
//   1. 取 TiMu 内 `.Zy_ulTop > li` 作为选项节点
//   2. 为每个 answer（多选时多个）：
//      a. 精确文本匹配选项 → 点击（若未选）
//      b. 精确失败 + useSimilarity=true → 走 Levenshtein 兜底
//   3. 用 Set 防重复选（超星多选题重复 click 会取消已选）
//
// 返回：filled（全答上）/ partial（部分）/ error（0 匹配）/ unsupported（找不到选项结构）

import { findBestMatch } from '../similarity';
import {
  extractChaoxingOptionText,
  isChaoxingOptionSelected,
  removeHtml,
  type FillContext,
  type FillResult,
} from './types';

export interface ChoiceFillOptions {
  /** 精确未匹配时是否走相似度兜底，默认 true */
  useSimilarity?: boolean;
  /** 相似度阈值 0-100，默认 50（与 app.js:5083 一致） */
  threshold?: number;
  /** 选项容器选择器，默认 chaoxing `.Zy_ulTop > li` */
  optionSelector?: string;
}

export function fillChoice(
  ctx: FillContext,
  answers: string[],
  opts: ChoiceFillOptions = {},
): FillResult {
  const {
    useSimilarity = true,
    threshold = 50,
    optionSelector = '.Zy_ulTop > li',
  } = opts;

  const optionLis = Array.from(ctx.timu.querySelectorAll<HTMLElement>(optionSelector));
  if (optionLis.length === 0) {
    return {
      status: 'unsupported',
      message: `未找到选项元素（${optionSelector}）`,
      matched: 0,
      total: answers.length,
    };
  }

  // 构建 key(text) → li 映射。空文本（纯图片选项）跳过 —— 此时此题文本匹配不了
  const optionsMap: Record<string, HTMLElement> = {};
  for (const li of optionLis) {
    const text = extractChaoxingOptionText(li);
    if (text) optionsMap[text] = li;
  }

  if (Object.keys(optionsMap).length === 0) {
    return {
      status: 'unsupported',
      message: '选项全是纯图片，当前不支持图片选项答题',
      matched: 0,
      total: answers.length,
    };
  }

  const selectedKeys = new Set<string>();
  let matched = 0;

  for (const rawAnswer of answers) {
    const cleanAnswer = removeHtml(rawAnswer);

    // 1. 精确匹配
    let hitKey: string | null = null;
    if (cleanAnswer in optionsMap && !selectedKeys.has(cleanAnswer)) {
      hitKey = cleanAnswer;
    }

    // 2. 相似度兜底
    if (!hitKey && useSimilarity) {
      const remaining: Record<string, HTMLElement> = {};
      for (const [k, v] of Object.entries(optionsMap)) {
        if (!selectedKeys.has(k)) remaining[k] = v;
      }
      const best = findBestMatch(cleanAnswer, remaining, threshold);
      if (best) hitKey = best.key;
    }

    if (!hitKey) continue;

    const li = optionsMap[hitKey]!;
    selectedKeys.add(hitKey);
    if (!isChaoxingOptionSelected(li)) {
      try {
        li.click();
      } catch {
        // click 失败不致命：记作匹配，让上层决定重试
      }
    }
    matched++;
  }

  if (matched === 0) {
    return {
      status: 'error',
      message: '所有答案都没匹配到选项',
      matched: 0,
      total: answers.length,
    };
  }
  if (matched < answers.length) {
    return {
      status: 'partial',
      message: `${matched}/${answers.length} 答案匹配`,
      matched,
      total: answers.length,
    };
  }
  return { status: 'filled', matched, total: answers.length };
}
