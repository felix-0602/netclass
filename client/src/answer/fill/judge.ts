// 判断题回填
//
// 对应旧 app.js:5190-5221 的 type 3 分支。
//
// 服务端返回的"对/错"文本可能是多种语种/表达方式，按正则归一：
//   对 / 是 / 正确 / √ / true / T / yes / 1 → TRUE
//   错 / 否 / 非 / × / X / false / F / no / 0 → FALSE
//
// 超星判断题 DOM：`.Zy_ulTop > li` 两个，通过 aria-label 包含"对选择"/"错选择"
// 或子元素 `span[data="true"]` / `span[data="false"]` 定位。

import { isChaoxingOptionSelected, removeHtml, type FillContext, type FillResult } from './types';

const RE_TRUE = /(^|[,，、])(是|对|正确|确定|√|对的|是的|正确的|true|True|T|yes|1)($|[,，、])/i;
const RE_FALSE = /(^|[,，、])(非|否|错|错误|×|X|错的|不对|不正确的|不正确|不是|不是的|false|False|F|no|0)($|[,，、])/i;

export function fillJudge(ctx: FillContext, answers: string[]): FillResult {
  if (answers.length === 0) {
    return { status: 'error', message: '空答案', matched: 0, total: 1 };
  }

  const raw = removeHtml(answers[0] ?? '');
  const tag: 'true' | 'false' | null = RE_TRUE.test(raw) ? 'true' : RE_FALSE.test(raw) ? 'false' : null;
  if (!tag) {
    return {
      status: 'error',
      message: `答案 "${raw}" 无法解析为对/错`,
      matched: 0,
      total: 1,
    };
  }

  const optionLis = Array.from(ctx.timu.querySelectorAll<HTMLElement>('.Zy_ulTop > li'));
  if (optionLis.length === 0) {
    return { status: 'unsupported', message: '未找到 .Zy_ulTop > li', matched: 0, total: 1 };
  }

  // 策略 A: aria-label 含 "对选择" / "错选择"（zj/zy 新版）
  const labelKeyword = tag === 'true' ? '对选择' : '错选择';
  let target = optionLis.find((li) => (li.getAttribute('aria-label') ?? '').includes(labelKeyword));

  // 策略 B: span[data="true"] / [data="false"]（ks 考试版）
  if (!target) {
    for (const li of optionLis) {
      const span = li.querySelector<HTMLElement>(`span[data="${tag}"]`);
      if (span) {
        target = span.closest<HTMLElement>('li') ?? li;
        break;
      }
    }
  }

  // 策略 C: 文字匹配（兜底，依赖 extractChaoxingOptionText 拿到的 text 含"对"/"错"）
  if (!target) {
    const keyword = tag === 'true' ? /^(对|正确|是|T|True|true)$/ : /^(错|错误|否|非|F|False|false)$/;
    target = optionLis.find((li) => keyword.test((li.textContent ?? '').trim()));
  }

  if (!target) {
    return { status: 'error', message: `找不到"${tag === 'true' ? '对' : '错'}"选项`, matched: 0, total: 1 };
  }

  if (isChaoxingOptionSelected(target)) {
    return { status: 'skipped', message: '已选中', matched: 1, total: 1 };
  }

  try {
    target.click();
  } catch (e) {
    return { status: 'error', message: `click 失败: ${(e as Error).message}`, matched: 0, total: 1 };
  }

  return { status: 'filled', matched: 1, total: 1 };
}
