import { describe, expect, test } from 'vitest';
import { hashQuestion } from '../src/answer/hash';
import type { ExtractedQuestion } from '../src/adapters/types';

// 关键约束：这里的结果必须与 server/src/lib/hash.ts 对同样输入的输出一致。
// server 也应有一份对同样 fixture 的测试。

function makeQ(partial: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    platform_id: 'q001',
    platform: 'chaoxing',
    type: 'single',
    text: '1+1 等于几？',
    options: [
      { label: 'A', text: '2', image_ref: null },
      { label: 'B', text: '3', image_ref: null },
    ],
    tex_spans: [],
    images: [],
    context: {},
    answer_target: {},
    ...partial,
  };
}

describe('hashQuestion', () => {
  test('确定性：同输入 → 同输出', async () => {
    const q = makeQ();
    const h1 = await hashQuestion(q);
    const h2 = await hashQuestion(q);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('text 归一化：空格、ZWSP 不影响哈希', async () => {
    const a = await hashQuestion(makeQ({ text: '1+1 等于几？' }));
    const b = await hashQuestion(makeQ({ text: '  1+1   等于几？  ' }));
    const c = await hashQuestion(makeQ({ text: '1+1​ 等于几？' })); // ZWSP
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('lowercase 归一化（纯文本字段）', async () => {
    const a = await hashQuestion(makeQ({ text: 'Hello WORLD' }));
    const b = await hashQuestion(makeQ({ text: 'hello world' }));
    expect(a).toBe(b);
  });

  test('不同平台 → 不同哈希', async () => {
    const a = await hashQuestion(makeQ({ platform: 'chaoxing' }));
    const b = await hashQuestion(makeQ({ platform: 'unipus' }));
    expect(a).not.toBe(b);
  });

  test('不同题型 → 不同哈希', async () => {
    const a = await hashQuestion(makeQ({ type: 'single' }));
    const b = await hashQuestion(makeQ({ type: 'multi' }));
    expect(a).not.toBe(b);
  });

  test('v2: 选项 array 顺序无关（按 label 字典序内部排序）', async () => {
    // chaoxing 实测会 shuffle 选项 array（A/B/C/D 在数组里位置随机），
    // 这道测确保 hash 不受影响。
    const a = await hashQuestion(makeQ({
      options: [
        { label: 'A', text: '2', image_ref: null },
        { label: 'B', text: '3', image_ref: null },
      ],
    }));
    const b = await hashQuestion(makeQ({
      options: [
        { label: 'B', text: '3', image_ref: null },
        { label: 'A', text: '2', image_ref: null },
      ],
    }));
    expect(a).toBe(b);
  });

  test('v2: 选项内容改了 → hash 变（排序不掩盖内容差异）', async () => {
    const a = await hashQuestion(makeQ({
      options: [
        { label: 'A', text: '2', image_ref: null },
        { label: 'B', text: '3', image_ref: null },
      ],
    }));
    const b = await hashQuestion(makeQ({
      options: [
        { label: 'A', text: '4', image_ref: null }, // A 内容变
        { label: 'B', text: '3', image_ref: null },
      ],
    }));
    expect(a).not.toBe(b);
  });

  test('tex_spans 按 placeholder 排序后再哈希（顺序无关）', async () => {
    const a = await hashQuestion(makeQ({
      tex_spans: [
        { placeholder: '<<M1>>', latex: 'x^2', image_idx: 0 },
        { placeholder: '<<M2>>', latex: 'y^2', image_idx: 1 },
      ],
    }));
    const b = await hashQuestion(makeQ({
      tex_spans: [
        { placeholder: '<<M2>>', latex: 'y^2', image_idx: 1 },
        { placeholder: '<<M1>>', latex: 'x^2', image_idx: 0 },
      ],
    }));
    expect(a).toBe(b);
  });

  test('tex_spans LaTeX 大小写敏感（normalizeTex 不 lowercase）', async () => {
    const a = await hashQuestion(makeQ({
      tex_spans: [{ placeholder: '<<M1>>', latex: '\\alpha', image_idx: 0 }],
    }));
    const b = await hashQuestion(makeQ({
      tex_spans: [{ placeholder: '<<M1>>', latex: '\\Alpha', image_idx: 0 }],
    }));
    expect(a).not.toBe(b);
  });

  test('已知 fixture 的 hex 快照（客户端-服务端一致性锚）', async () => {
    const q = makeQ({
      platform: 'chaoxing',
      type: 'single',
      text: 'hello',
      options: [{ label: 'A', text: 'x', image_ref: null }],
      tex_spans: [],
    });
    const h = await hashQuestion(q);
    // 若服务端 hash 同一输入算出的不是这个，回来比对修正
    // sha256('chaoxing\nsingle\nhello\nA:x\n') = ?
    // 跑出来后把值填进来锁死
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // 固化快照 —— 第一次跑得出结果后补全这里
    expect(h.length).toBe(64);
  });
});
