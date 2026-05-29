import { MathDetectionResult } from './math-detector';

interface AssessContext {
  title: string;
  questionCount: number;
  mathResult: MathDetectionResult;
  questionTypes: string[];
}

interface AssessDecision {
  doable: boolean;
  reason: string;
}

interface PopupAnalysis {
  action: 'click_confirm' | 'click_cancel' | 'click_retry' | 'no_action';
  selector?: string;
  reason?: string;
}

interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * DeepSeek "brain" — makes supervision decisions:
 * 1. Task assessment (doable vs skip)
 * 2. Popup/dialog analysis (what button to click)
 */
export class DeepSeekBrain {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.deepseek.com/v1';
  }

  private async call(
    systemPrompt: string,
    userPrompt: string,
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 500,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Assess whether a task can be auto-completed.
   * Called by assess-task node.
   */
  async assessTask(ctx: AssessContext): Promise<AssessDecision> {
    // Fast path: pure math task with blind spots → always skip
    if (ctx.mathResult.blindSpotCount >= 2 && ctx.mathResult.formulaCount >= ctx.questionCount * 0.5) {
      return {
        doable: false,
        reason: `大量数学盲区公式（${ctx.mathResult.formulaCount}/${ctx.questionCount}），无法保障正确率`,
      };
    }

    // Fast path: pure text questions → always doable
    if (!ctx.mathResult.hasMath) {
      return { doable: true, reason: '' };
    }

    // Mixed: ask DeepSeek
    const systemPrompt = `你是一个智能作业处理判断系统。分析作业元数据，判断是否适合AI自动完成。

判断标准：
- 数学公式题（含 \\frac \\sum \\int \\sqrt \\lim 等）如果占比超过30%，且含"盲区公式"（图片无LaTeX源码），必须跳过
- 纯文本选择题/判断题/填空题，即使有少量普通公式也可以做
- 论述题/简答题如果无法自动评分，标记跳过
- 输出格式：{"doable": true/false, "reason": "用一句话说明原因"}`;

    const userPrompt = `任务标题：${ctx.title}
题目总数：${ctx.questionCount}
数学公式题数：${ctx.mathResult.formulaCount}
盲区图片公式：${ctx.mathResult.blindSpotCount}
题型分布：${ctx.questionTypes.join(', ')}

这个任务能做吗？`;

    const raw = await this.call(systemPrompt, userPrompt);
    try {
      return JSON.parse(raw.trim()) as AssessDecision;
    } catch {
      // Fallback: assume doable if we can't parse
      return { doable: true, reason: '' };
    }
  }

  /**
   * Analyze a popup/dialog blocking task submission.
   * Called by handle-blocker node.
   */
  async analyzePopup(context: {
    taskTitle: string;
    pageUrl: string;
    pageText: string;
  }): Promise<PopupAnalysis> {
    const systemPrompt = `你正在查看一个作业提交后出现的页面。系统尝试提交作业但页面可能有弹窗/提示。

判断规则：
1. 如果是"确认提交"对话框 → click_confirm，选择器用 .layui-layer-btn0 或 .jb_btn
2. 如果是"未到及格线，请重做"提示 → no_action（不要点重做，会清空答案）
3. 如果是"任务点未完成"弹窗 → click_confirm，选择器用 .nextChapter
4. 如果是正常批改结果页 → no_action
5. 如果页面没有任何弹窗且显示批改结果 → no_action

输出JSON：{"action": "click_confirm"|"click_cancel"|"click_retry"|"no_action", "selector": "CSS选择器（可选）", "reason": "判断理由"}`;

    const userPrompt = `任务标题：${context.taskTitle}
当前URL：${context.pageUrl}
页面文本片段：
${context.pageText.slice(0, 3000)}`;

    const raw = await this.call(systemPrompt, userPrompt);
    try {
      return JSON.parse(raw.trim()) as PopupAnalysis;
    } catch {
      return { action: 'no_action', reason: '无法解析DeepSeek响应' };
    }
  }
}
