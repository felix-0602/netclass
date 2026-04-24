import { describe, expect, test } from 'vitest';
import {
  findBestMatch,
  levenshtein,
  similarityScore,
} from '../src/answer/similarity';

describe('levenshtein', () => {
  test('相同字符串距离 0', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
  });

  test('空字符串', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  test('单字替换', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  test('插入删除', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  test('中文也行', () => {
    expect(levenshtein('同学你好', '同学您好')).toBe(1);
    expect(levenshtein('是', '否')).toBe(1);
  });

  test('经典 kitten/sitting', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('similarityScore', () => {
  test('完全相同 = 100', () => {
    expect(similarityScore('abc', 'abc')).toBe(100);
    expect(similarityScore('  abc  ', 'abc')).toBe(100);
  });

  test('完全不同 ≈ 0', () => {
    expect(similarityScore('abc', 'xyz')).toBe(0);
  });

  test('常见标点 / 括号会被归一化', () => {
    expect(similarityScore('(正确)', '正确')).toBe(100);
    expect(similarityScore('是。', '是')).toBe(100);
    expect(similarityScore('正确！', '正确')).toBe(100);
    // 冒号折空格、空格折空格，但"答案：x²"与"答案 x²"归一化后仍差一个空格位
    // —— 语义上也不算完全相同，只要求分数 >= 80 就行（够穿 50 阈值）
    expect(similarityScore('答案：x²', '答案 x²')).toBeGreaterThanOrEqual(80);
  });

  test('全半角空格等价', () => {
    expect(similarityScore('a  b  c', 'a b c')).toBe(100);
  });

  test('大小写不敏感', () => {
    expect(similarityScore('True', 'true')).toBe(100);
  });

  test('几乎相同的长句子 ≥80', () => {
    const a = '这是一个测试题干';
    const b = '这是一个测试题目';
    expect(similarityScore(a, b)).toBeGreaterThanOrEqual(80);
  });

  test('1/5 不同 ≈ 80', () => {
    expect(similarityScore('abcde', 'abcdX')).toBe(80);
  });

  test('两空串视为完全相同', () => {
    expect(similarityScore('', '')).toBe(100);
  });

  test('一空一非空 = 0', () => {
    expect(similarityScore('', 'abc')).toBe(0);
    expect(similarityScore('abc', '')).toBe(0);
  });
});

describe('findBestMatch', () => {
  test('精确命中返回 100', () => {
    const options = { A: 1, B: 2, C: 3 };
    const hit = findBestMatch('A', options);
    expect(hit).toEqual({ key: 'A', option: 1, score: 100 });
  });

  test('同义近义归一化命中', () => {
    const options = { 是: 'opt-a', 否: 'opt-b' };
    const hit = findBestMatch('(是)', options);
    expect(hit?.key).toBe('是');
    expect(hit?.score).toBe(100);
  });

  test('阈值以下返回 null', () => {
    const options = { 是: 'opt-a', 否: 'opt-b' };
    // "xyz" vs "是"、"否" 都极低
    const hit = findBestMatch('xyz', options);
    expect(hit).toBeNull();
  });

  test('多个近似候选返回最高', () => {
    const options = { '2x+1': 'a', '2x-1': 'b', '3x+1': 'c' };
    // "2x + 1" 对三个都有差；'2x+1' 精确；其他次之
    const hit = findBestMatch('2x + 1', options);
    expect(hit?.key).toBe('2x+1');
  });

  test('自定义阈值', () => {
    const options = { foo: 1, bar: 2 };
    // foo vs fox 相似度 ≈ 66.7
    expect(findBestMatch('fox', options, 70)).toBeNull();
    expect(findBestMatch('fox', options, 60)).toMatchObject({ key: 'foo' });
  });

  test('空 options 返回 null', () => {
    expect(findBestMatch('x', {})).toBeNull();
  });
});
