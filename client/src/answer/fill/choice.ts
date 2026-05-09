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

  // 构建两个映射：
  //   labelMap: A/B/C/D → li（用于 server 返字母答案 "B" 直接定位）
  //   textMap: optionText → li（用于历史/外部答案是文本时的匹配）
  // server `/answer` 命中返 {value: "B", raw: ["B"]}，answers 全是字母 → 走 labelMap 直通
  const labelMap: Record<string, HTMLElement> = {};
  const textMap: Record<string, HTMLElement> = {};
  for (const li of optionLis) {
    const numOpt = li.querySelector<HTMLElement>('.num_option');
    const dataLabel = numOpt?.getAttribute('data')?.trim()
      || numOpt?.textContent?.trim();
    if (dataLabel && /^[A-Z]$/.test(dataLabel)) labelMap[dataLabel] = li;
    const text = extractChaoxingOptionText(li);
    if (text) textMap[text] = li;
  }

  if (Object.keys(labelMap).length === 0 && Object.keys(textMap).length === 0) {
    return {
      status: 'unsupported',
      message: '选项 li 既无 A/B/C/D label 也无可读文本',
      matched: 0,
      total: answers.length,
    };
  }

  const selectedKeys = new Set<string>();
  let matched = 0;

  for (const rawAnswer of answers) {
    const cleanAnswer = removeHtml(rawAnswer);
    let hitKey: string | null = null;
    let hitLi: HTMLElement | null = null;

    // 1. 字母答案直通（最常见 — server hit 返 "A"/"B"/"C"/"D"）
    if (/^[A-Z]$/.test(cleanAnswer) && labelMap[cleanAnswer] && !selectedKeys.has(cleanAnswer)) {
      hitKey = cleanAnswer;
      hitLi = labelMap[cleanAnswer];
    }

    // 2. 文本精确匹配
    if (!hitLi && cleanAnswer in textMap && !selectedKeys.has(cleanAnswer)) {
      hitKey = cleanAnswer;
      hitLi = textMap[cleanAnswer]!;
    }

    // 3. 相似度兜底（只针对文本，字母失败不再降级）
    if (!hitLi && useSimilarity && Object.keys(textMap).length > 0) {
      const remaining: Record<string, HTMLElement> = {};
      for (const [k, v] of Object.entries(textMap)) {
        if (!selectedKeys.has(k)) remaining[k] = v;
      }
      const best = findBestMatch(cleanAnswer, remaining, threshold);
      if (best) {
        hitKey = best.key;
        hitLi = remaining[best.key]!;
      }
    }

    if (!hitLi || !hitKey) continue;
    selectedKeys.add(hitKey);
    if (!isChaoxingOptionSelected(hitLi)) {
      try {
        hitLi.click();
      } catch {
        // click 失败不记 matched——DOM 未被修改，上层不应假定成功
        continue;
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
