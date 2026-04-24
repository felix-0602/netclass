// 简答 / 论述题回填（type 4/6）
//
// 对应旧 app.js:5222-5229。跟填空的区别：
//   - 填空有多个 textarea（每个空一个），答案数组每项对应一个空
//   - 简答只有一个 textarea，answer[0] 整段塞进去
//
// 跟 blank 共享大部分实现；这里单独一个 handler 是为了 filler 派发清晰。

import { removeHtml, type FillContext, type FillResult } from './types';

interface UEditorLike {
  getEditor(name: string): { setContent: (html: string) => void } | null;
}

export function fillEssay(ctx: FillContext, answers: string[]): FillResult {
  const ta = ctx.timu.querySelector<HTMLTextAreaElement>('textarea');
  if (!ta) {
    return { status: 'unsupported', message: '未找到 <textarea>', matched: 0, total: 1 };
  }

  const answer = removeHtml(answers[0] ?? '');
  if (!answer) {
    return { status: 'error', message: '空答案', matched: 0, total: 1 };
  }

  const win = ctx.doc.defaultView as (Window & { UE?: UEditorLike }) | null;
  const UE = win?.UE;

  if (UE) {
    try {
      const editor = UE.getEditor(ta.name);
      if (editor) {
        editor.setContent(answer);
        return { status: 'filled', matched: 1, total: 1 };
      }
    } catch (e) {
      // 继续 fallback
      return {
        status: 'partial',
        message: `UEditor 抛错: ${(e as Error).message}，fallback 到 textarea`,
        matched: 1,
        total: 1,
      };
    }
  }

  try {
    ta.value = answer;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { status: 'filled', matched: 1, total: 1 };
  } catch (e) {
    return { status: 'error', message: `textarea 写入失败: ${(e as Error).message}`, matched: 0, total: 1 };
  }
}
