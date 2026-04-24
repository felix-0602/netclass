import { describe, expect, test } from 'vitest';
import { decodeCxsecret } from '../src/decode/cxsecret';

describe('decodeCxsecret', () => {
  test('recon fixture: 高数 Q1 题干映射', () => {
    const obfuscated = '已知微抮方程 抦通解为 ，抩抨足抧值抰抪';
    const decoded = decodeCxsecret(obfuscated);
    // table.json 里有的映射至少要命中
    expect(decoded).toContain('分');
    expect(decoded).toContain('的');
    expect(decoded).not.toContain('抮');
    expect(decoded).not.toContain('抦');
  });

  test('不含混淆字的纯文本原样透传', () => {
    expect(decodeCxsecret('已知微分方程')).toBe('已知微分方程');
    expect(decodeCxsecret('The Grand Canal')).toBe('The Grand Canal');
    expect(decodeCxsecret('')).toBe('');
  });

  test('表里没有的字符原样透传', () => {
    const input = '陌生字符♿♻♬';
    expect(decodeCxsecret(input)).toBe(input);
  });
});
