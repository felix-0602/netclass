export interface MathDetectionResult {
  hasMath: boolean;
  formulaCount: number;
  blindSpotCount: number;
  details: Array<{ placeholder: string; hasLatex: boolean; imageIdx: number | null }>;
}

const MATH_KEYWORDS = [
  '\\frac', '\\sum', '\\int', '\\sqrt', '\\lim',
  '\\infty', '\\partial', '\\Delta', '\\theta',
  '\\sin', '\\cos', '\\tan', '\\log', '\\ln',
  '\\leq', '\\geq', '\\neq', '\\approx',
  '\\alpha', '\\beta', '\\gamma', '\\pi',
  '\\cup', '\\cap', '\\subset', '\\subseteq',
  '\\mathbb', '\\mathcal', '\\mathbf',
  '\\matrix', '\\begin', '\\end',
  '\\over', '\\choose', '\\atop',
  '\\overrightarrow', '\\overleftarrow',
  '\\overline', '\\underline',
];

const MATH_UNICODE = /[∫∑∏√∞∂∇ΔθπμσΩ∪∩⊂⊆⊇∈∉≤≥≠≈±×÷→←↑↓↔⇒⇔∀∃∄∅]/g;

/**
 * Analyze tex_spans for math formula patterns that produce garbled answers.
 * Returns whether the question should be skipped.
 */
export function detectMathFormulas(
  texSpans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }> | undefined,
): MathDetectionResult {
  if (!texSpans || texSpans.length === 0) {
    return { hasMath: false, formulaCount: 0, blindSpotCount: 0, details: [] };
  }

  let formulaCount = 0;
  let blindSpotCount = 0;
  const details: MathDetectionResult['details'] = [];

  for (const span of texSpans) {
    const hasLatex = span.latex !== null && span.latex.trim().length > 0;
    const isBlind = !hasLatex && span.image_idx !== null;

    if (hasLatex) {
      const hasMathKeyword = MATH_KEYWORDS.some(kw => span.latex!.includes(kw));
      if (hasMathKeyword) {
        formulaCount++;
        details.push({ placeholder: span.placeholder, hasLatex: true, imageIdx: span.image_idx });
      }
    } else if (isBlind) {
      blindSpotCount++;
      formulaCount++;
      details.push({ placeholder: span.placeholder, hasLatex: false, imageIdx: span.image_idx });
    }
  }

  return {
    hasMath: formulaCount > 0,
    formulaCount,
    blindSpotCount,
    details,
  };
}

/**
 * Quick pre-check from question text alone.
 * Scans for common math glyphs that indicate formula content.
 */
export function quickMathCheck(text: string): boolean {
  MATH_UNICODE.lastIndex = 0;
  return MATH_UNICODE.test(text);
}

/**
 * Determine if a task should be skipped due to math formulas.
 * Skips if there are blind-spot formulas with no LaTeX source,
 * or more than 3 math formulas in total.
 */
export function shouldSkipForMath(result: MathDetectionResult): {
  skip: boolean;
  reason?: string;
} {
  if (result.blindSpotCount >= 2) {
    return {
      skip: true,
      reason: `盲区公式 ${result.blindSpotCount} 个（图片无 LaTeX 源码），AI 填空会产生乱码`,
    };
  }
  if (result.formulaCount >= 5) {
    return {
      skip: true,
      reason: `数学公式 ${result.formulaCount} 个过多，准确率无保障`,
    };
  }
  return { skip: false };
}
