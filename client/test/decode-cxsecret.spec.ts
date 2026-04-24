import { describe, expect, test } from 'vitest';
import { decodeCxsecretWithMatch, needsDecode } from '../src/decode/cxsecret';

/**
 * buildFontMatch / decryptDocument 需要浏览器 DOM + 真实 ttf base64 —— 属 E2E 范畴。
 * 这里只测纯函数 decodeCxsecretWithMatch（给定 match 替换混淆字符）+ needsDecode。
 *
 * 真实字体解析的 regression 在 Playwright `test/e2e/extract-chaoxing.spec.ts`
 * 里用 fixture HTML 跑。
 */

describe('decodeCxsecretWithMatch', () => {
  // 构造 fake match：模拟超星字体表里 CJK codepoint 的重映射
  //   U+62AE (抮) → U+5206 (分)
  //   U+62A6 (抦) → U+7684 (的)
  const fakeMatch = {
    0x62ae: 0x5206, // 抮 → 分
    0x62a6: 0x7684, // 抦 → 的
  };

  test('recon fixture: 高数 Q1 题干替换（mock match）', () => {
    const obfuscated = '已知微抮方程 抦通解为 ，抩抨足抧值抰抪';
    const decoded = decodeCxsecretWithMatch(obfuscated, fakeMatch);
    expect(decoded).toContain('分');
    expect(decoded).toContain('的');
    expect(decoded).not.toContain('抮');
    expect(decoded).not.toContain('抦');
  });

  test('不含混淆字的纯文本原样透传', () => {
    expect(decodeCxsecretWithMatch('已知微分方程', fakeMatch)).toBe('已知微分方程');
    expect(decodeCxsecretWithMatch('The Grand Canal', fakeMatch)).toBe('The Grand Canal');
    expect(decodeCxsecretWithMatch('', fakeMatch)).toBe('');
  });

  test('match 里没有的字符原样透传', () => {
    const input = '陌生字符♿♻♬';
    expect(decodeCxsecretWithMatch(input, fakeMatch)).toBe(input);
  });

  test('空 match → 全部原样返回', () => {
    const input = '已知微抮方程抦通解';
    expect(decodeCxsecretWithMatch(input, {})).toBe(input);
  });
});

describe('needsDecode', () => {
  test('null 元素 → false', () => {
    expect(needsDecode(null)).toBe(false);
  });

  test('自身带 font-cxsecret class → true', () => {
    const el = document.createElement('div');
    el.className = 'font-cxsecret fontLabel';
    expect(needsDecode(el)).toBe(true);
  });

  test('祖先带 font-cxsecret → true', () => {
    const parent = document.createElement('div');
    parent.className = 'font-cxsecret';
    const child = document.createElement('span');
    parent.appendChild(child);
    expect(needsDecode(child)).toBe(true);
  });

  test('没有 font-cxsecret → false', () => {
    const el = document.createElement('p');
    expect(needsDecode(el)).toBe(false);
  });
});
