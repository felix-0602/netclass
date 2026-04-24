// @vitest-environment node

import { describe, expect, test } from 'vitest';
import { hashQuestion } from '../src/lib/hash';

const baseQuestion = {
  platform: 'chaoxing' as const,
  type: 'single' as const,
  text: 'f(x) = x^2, find the derivative.',
  options: [
    { label: 'A', text: '2x', image_ref: null },
    { label: 'B', text: 'x^2', image_ref: null },
  ],
  tex_spans: [
    { placeholder: '__T2__', latex: 'x^2', image_idx: null },
    { placeholder: '__T1__', latex: 'f(x)', image_idx: null },
  ],
};

describe('hashQuestion', () => {
  test('returns the same hash for the same content', async () => {
    const hash1 = await hashQuestion(baseQuestion);
    const hash2 = await hashQuestion(baseQuestion);

    expect(hash1).toBe(hash2);
  });

  test('stays stable when tex_spans order changes', async () => {
    const hash1 = await hashQuestion(baseQuestion);
    const hash2 = await hashQuestion({
      ...baseQuestion,
      tex_spans: [...baseQuestion.tex_spans].reverse(),
    });

    expect(hash1).toBe(hash2);
  });

  test('changes when latex content changes', async () => {
    const hash1 = await hashQuestion(baseQuestion);
    const hash2 = await hashQuestion({
      ...baseQuestion,
      tex_spans: baseQuestion.tex_spans.map((span) =>
        span.placeholder === '__T2__' ? { ...span, latex: 'x^3' } : span,
      ),
    });

    expect(hash1).not.toBe(hash2);
  });
});
