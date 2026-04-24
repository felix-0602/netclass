// 填空题回填
//
// 对应旧 app.js:5178-5189 的 type 2 分支。
//
// 超星填空用 UEditor 富文本：题目里每个空对应一个 <textarea>，真正内容在 UE.getEditor(name) 里。
// 直接写 textarea.value 不会显示（UEditor 用 contenteditable iframe 渲染）—— 必须调 UEditor API。
//
// Fallback：UEditor 没加载时（老版或被去掉）就 textarea.value = answer。

import { removeHtml, type FillContext, type FillResult } from './types';

// UEditor 暴露在 window 上
interface UEditorLike {
  getEditor(name: string): { setContent: (html: string) => void } | null;
}

export function fillBlank(ctx: FillContext, answers: string[]): FillResult {
  const textareas = ctx.timu.querySelectorAll<HTMLTextAreaElement>('textarea');
  if (textareas.length === 0) {
    return {
      status: 'unsupported',
      message: '未找到 <textarea>',
      matched: 0,
      total: answers.length,
    };
  }

  const win = ctx.doc.defaultView as (Window & { UE?: UEditorLike }) | null;
  const UE = win?.UE;

  let matched = 0;
  const errors: string[] = [];

  textareas.forEach((ta, idx) => {
    if (idx >= answers.length) return; // 答案数不够填所有空，剩下的留白

    const answer = removeHtml(answers[idx] ?? '');
    if (!answer) return;

    // 优先 UEditor
    if (UE) {
      try {
        const editor = UE.getEditor(ta.name);
        if (editor) {
          editor.setContent(answer);
          matched++;
          return;
        }
      } catch (e) {
        errors.push(`UEditor[${ta.name}] 抛错: ${(e as Error).message}`);
      }
    }

    // Fallback: 直接写 textarea value
    try {
      ta.value = answer;
      // 触发 input 事件让页面感知变化（有些表单监听 input 来启用提交按钮）
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      matched++;
    } catch (e) {
      errors.push(`textarea[${ta.name}]: ${(e as Error).message}`);
    }
  });

  const total = Math.min(textareas.length, answers.length);

  if (matched === 0) {
    return {
      status: 'error',
      message: errors.length > 0 ? errors.join('; ') : '未填入任何空',
      matched: 0,
      total,
    };
  }
  if (matched < total) {
    return {
      status: 'partial',
      message: `${matched}/${total} 空已填入${errors.length ? ' · ' + errors.join('; ') : ''}`,
      matched,
      total,
    };
  }
  return {
    status: 'filled',
    matched,
    total,
    message: errors.length > 0 ? errors.join('; ') : undefined,
  };
}
