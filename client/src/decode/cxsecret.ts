// 超星字体反混淆
// 详见：docs/CXSECRET.md

import table from './table.json';

const MAP = table as Record<string, string>;

/**
 * 解超星 font-cxsecret 字体混淆。
 *
 * 输入是爬虫/DOM.innerText 看到的"乱码中文"，输出是人眼看到的真实文本。
 *
 * 算法：逐字符替换，优先贪婪匹配多字符 key（表里偶尔有）。
 */
export function decodeCxsecret(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (i + 1 < input.length) {
      const two = input.substring(i, i + 2);
      if (two in MAP) {
        out += MAP[two];
        i += 2;
        continue;
      }
    }
    const one = input[i];
    out += one in MAP ? MAP[one] : one;
    i += 1;
  }
  return out;
}

/** 判断某元素是否在 font-cxsecret 作用域内（自身或任意祖先有该 class） */
export function needsDecode(el: Element | null): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.classList?.contains('font-cxsecret')) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** 对 DOM 节点递归解文本（不改 DOM，返回解码后的字符串） */
export function decodeElement(el: Element): string {
  if (needsDecode(el)) {
    return decodeCxsecret(el.textContent ?? '');
  }
  return el.textContent ?? '';
}
