// 共享 DeepSeek 答案解析 — server deepseek.ts / drain-deepseek.ts / drain-vision.ts 共用
// 单点维护，避免三处重复

export interface ParsedAnswer {
  value: string;
  raw: string[];
}

export function parseAnswer(raw: string, type: string): ParsedAnswer | null {
  switch (type) {
    case 'single': {
      const m = raw.match(/[A-D]/);
      if (!m) return null;
      return { value: m[0], raw: [m[0]] };
    }
    case 'multi': {
      const letters = raw.match(/[A-D]/g);
      if (!letters || letters.length === 0) return null;
      const unique = [...new Set(letters)].sort();
      return { value: unique.join(','), raw: unique };
    }
    case 'judge': {
      const cleaned = raw.replace(/[，。！？\s]/g, '');
      if (/^对$|^正确$|^✓$|^true$/i.test(cleaned))
        return { value: 'true', raw: ['true'] };
      if (/^错$|^错误$|^✗$|^false$/i.test(cleaned))
        return { value: 'false', raw: ['false'] };
      return null;
    }
    case 'fill': {
      const clean = raw.replace(/^["'「『]|["'」』]$/g, '').trim();
      if (!clean) return null;
      const parts = clean.split('||').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) return null;
      return { value: clean, raw: parts };
    }
    case 'essay': {
      const clean = raw.replace(/^(答案[：:]\s*|回答[：:]\s*)/i, '').trim();
      if (!clean) return null;
      return { value: clean, raw: [clean] };
    }
    default:
      return null;
  }
}
