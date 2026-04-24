// 字符串相似度兜底 —— 当答案文本跟选项文本精确不匹配时用它找最接近的
//
// 典型场景：
//   - 服务端答案 "2x" vs 选项 "2x  "（多了空格）
//   - 服务端答案 "A. 是" vs 选项 "是"（带选项前缀）
//   - 服务端答案 "对" vs 选项 "正确"（同义）
// 前两种用 normalize 就能救；第三种要靠编辑距离 + 人工阈值。
//
// 算法：Levenshtein distance → 归一化到 0-100 相似度。
// 阈值默认 50（经验值，来自旧 app.js:5083 `threshold = 50`）。

/**
 * 计算两字符串的 Levenshtein 编辑距离（插入/删除/替换各计 1）。
 * O(m*n) 时空复杂度。对选项长度一般 <100，够用。
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 滚动数组优化：只保留上一行
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // 删
        curr[j - 1]! + 1, // 插
        prev[j - 1]! + cost, // 替/匹配
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * 0-100 相似度分数。两串相同 = 100；完全不同 = 0。
 * 公式：`(1 - distance / max(|a|, |b|)) * 100`
 */
export function similarityScore(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x && !y) return 100;
  if (!x || !y) return 0;
  if (x === y) return 100;
  const d = levenshtein(x, y);
  const max = Math.max(x.length, y.length);
  return Math.round((1 - d / max) * 100);
}

/**
 * 归一化：去首尾空白 → 全半角空格折一个 → 去常见标点/括号 → lowercase。
 * 设计取舍：中文标点不转，但与英文对应的全角版本转一下；数字公式常见"²"不动。
 */
function normalizeForCompare(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[，。；！？、：,.;!?:]/g, '')
    .replace(/[()（）\[\]【】{}]/g, '')
    .toLowerCase();
}

export interface MatchResult<T> {
  key: string;
  option: T;
  score: number;
}

/**
 * 在选项 map 里找与 `answer` 最接近的 key。
 * 返回得分 ≥ threshold 的最佳匹配；全低于阈值返回 null。
 *
 * 用法示例（对应旧 app.js:5076 findBestMatch）：
 *   const options = { '是': optionElementA, '否': optionElementB };
 *   const hit = findBestMatch('正确', options);
 *   if (hit) hit.option.click();
 */
export function findBestMatch<T>(
  answer: string,
  options: Record<string, T>,
  threshold = 50,
): MatchResult<T> | null {
  let best: MatchResult<T> | null = null;
  for (const [key, option] of Object.entries(options)) {
    const score = similarityScore(answer, key);
    if (score >= threshold && (!best || score > best.score)) {
      best = { key, option, score };
      if (score === 100) return best; // 早退
    }
  }
  return best;
}
