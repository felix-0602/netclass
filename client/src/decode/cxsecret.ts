// 超星 font-cxsecret 反混淆 — 真实算法实现
// 详见：docs/CXSECRET.md
// 算法源头：app.js:4884-4932 decrypt()

// @ts-expect-error — 本地 vendored JS，无类型声明
import { Font } from './_vendor/typr-font.js';
import md5 from 'blueimp-md5';
import table from './table.json';

const HASH_TABLE = table as unknown as Record<string, number>;

// CJK Unified Ideographs Unicode 范围
const CJK_START = 19968; // U+4E00
const CJK_END = 40870; // U+9FA6

/**
 * 一个页面内可能出现多张不同的 font-cxsecret 字体（超星每次请求都随机生成）。
 * 每张字体对应一份 match 映射。
 */
export interface FontMatchMap {
  /** 混淆字符 codepoint → 真实字符 codepoint */
  [obfuscatedCodepoint: number]: number;
}

/**
 * 从 iframe/document 里扫 `<style>` 标签，解 @font-face base64 ttf，
 * 对每个 CJK codepoint 计算 glyph path 的 md5，查表得真实码点。
 *
 * 返回 match 映射。如果页面里没有 font-cxsecret 样式 → 返回空 map。
 *
 * 这是 CPU 重活：20906 次 glyph path 遍历 + md5，首次 ~50-200ms。
 * 调用方应缓存（同一页面同一字体的 match 只算一次）。
 */
export function buildFontMatch(doc: Document): FontMatchMap {
  const styles = doc.querySelectorAll('style');
  let tipStyle: HTMLStyleElement | null = null;
  for (const s of Array.from(styles)) {
    if (s.textContent?.includes('font-cxsecret')) {
      tipStyle = s as HTMLStyleElement;
      break;
    }
  }
  if (!tipStyle) return {};

  const fontData = tipStyle.textContent?.match(/base64,([\w\W]+?)'/)?.[1];
  if (!fontData) return {};

  const buffer = base64ToArrayBuffer(fontData);
  const font = new Font(buffer);
  const match: FontMatchMap = {};

  for (let code = CJK_START; code < CJK_END; code++) {
    const glyph = font.codeToGlyph(code);
    if (!glyph) continue;
    const path = font.glyphToPath(glyph);
    const hash = md5(JSON.stringify(path)).slice(24);
    const realCodepoint = HASH_TABLE[hash];
    if (realCodepoint !== undefined) match[code] = realCodepoint;
  }

  return match;
}

/**
 * 原地解 DOM 里所有 font-cxsecret 元素：根据给定 match 把混淆字符替换为真实字符。
 *
 * 副作用：修改 DOM innerHTML + 移除 font-cxsecret class（防重复解）。
 * 参考 app.js:4911-4922。
 */
export function decryptDocumentInPlace(doc: Document, match: FontMatchMap): void {
  if (Object.keys(match).length === 0) return;
  const elements = doc.querySelectorAll('.font-cxsecret');
  for (const el of Array.from(elements)) {
    let html = el.innerHTML;
    for (const key in match) {
      const realChar = String.fromCharCode(match[key]);
      const re = new RegExp(String.fromCharCode(Number(key)), 'g');
      html = html.replace(re, realChar);
    }
    el.innerHTML = html;
    el.classList.remove('font-cxsecret');
  }
}

/**
 * 纯函数版：不改 DOM，拿一段 obfuscated 文本 + match 得到真实文本。
 * 主要给单元测试和 server-side 归一化用。
 */
export function decodeCxsecretWithMatch(input: string, match: FontMatchMap): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0);
    if (code !== undefined && match[code] !== undefined) {
      out += String.fromCharCode(match[code]);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 判断某元素是否在 font-cxsecret 作用域内 */
export function needsDecode(el: Element | null): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.classList?.contains('font-cxsecret')) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * 一步到位的 helper：解析 doc 里的字体，把所有 font-cxsecret 元素解完。
 * 返回 match 供外部复用/再加工。
 */
export function decryptDocument(doc: Document): FontMatchMap {
  const match = buildFontMatch(doc);
  if (Object.keys(match).length > 0) {
    decryptDocumentInPlace(doc, match);
  }
  return match;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}
