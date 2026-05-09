// drain-deepseek — 调 DeepSeek API 批量答 pending 队列里的数学题
//
// 用法：npx tsx cc-worker/drain-deepseek.ts [--limit N] [--dry-run]
// 环境：source ~/.netclass-drain.env

import { readFileSync } from "node:fs";
import { parseAnswer } from "./lib/deepseek-parser.js";

// ---- 加载 env ----
function loadEnv(): { server: string; adminKey: string; apiKey: string } {
  const envPath = `${process.env.HOME ?? process.env.USERPROFILE ?? "."}/.netclass-drain.env`;
  const raw = readFileSync(envPath, "utf-8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+)\s*=\s*(.+)/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return {
    server: out.NETCLASS_SERVER ?? "",
    adminKey: out.NETCLASS_ADMIN_KEY ?? "",
    apiKey: out.DEEPSEEK_API_KEY ?? "",
  };
}

interface PendingItem {
  id: string;
  type: string;
  text: string;
  options: Array<{ label: string; text: string | null; image_ref: string | null }>;
  tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
  composite_image_url: string | null;
  context: Record<string, string>;
}

interface Answer {
  id: string;
  answer: { value: string; raw: string[] };
  confidence: number;
  source: string;
  note: string;
}

// ---- 解码题目为可读文本 ----
function decodeQuestion(q: PendingItem): string {
  const texMap = new Map<string, string>();
  for (const s of q.tex_spans ?? []) {
    if (s.latex) texMap.set(s.placeholder, s.latex.trim());
  }

  const replaceTex = (t: string) =>
    t.replace(/<<M\d+>>/g, (m) => {
      const lx = texMap.get(m);
      return lx ? `$${lx}$` : m;
    });

  let out = replaceTex(q.text);
  for (const o of q.options ?? []) {
    out += `\n  ${o.label}. ${replaceTex(o.text ?? "")}`;
    if (o.image_ref && texMap.has(o.image_ref)) {
      out += ` ${replaceTex(o.image_ref)}`;
    }
  }
  return out;
}

// ---- 调 DeepSeek API ----
async function askDeepSeek(
  question: string,
  type: string,
  apiKey: string,
): Promise<{ value: string; raw: string[]; rawText: string } | null> {
  let typeHint: string;
  let systemPrompt: string;
  if (type === 'multi') {
    typeHint = '多选题，请只回复所有正确答案的字母，用逗号分隔（如 A,C），不要解释。';
    systemPrompt = '你是一个简洁的高等数学助教。多选题只回复所有正确答案字母，用逗号分隔。';
  } else if (type === 'judge') {
    typeHint = '判断题，请只回复"对"或"错"，不要解释。';
    systemPrompt = '你是一个简洁的高等数学助教。判断题只回复"对"或"错"。';
  } else if (type === 'fill') {
    typeHint = '填空题，请只回复填空的答案文本。如果有多个空，用 || 分隔（如 答案1||答案2||答案3），不要解释。';
    systemPrompt = '你是一个简洁的高等数学助教。填空题只回复答案文本，多空用 || 分隔。';
  } else {
    typeHint = '单选题，请只回复正确答案的字母（A/B/C/D），不要解释。';
    systemPrompt = '你是一个简洁的高等数学助教，只回复答案字母。';
  }

  const prompt = `你是一个高等数学助教。下面是一道${typeHint}

${question}

答案：`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 30,
    }),
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    console.error(`  DeepSeek API error ${res.status}: ${await res.text().then((t) => t.slice(0, 100))}`);
    return null;
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseAnswer(rawText, type);
  if (!parsed) return null;
  return { value: parsed.value, raw: parsed.raw, rawText };
}

// ---- 主流程 ----
async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10);
  const dryRun = args.includes("--dry-run");

  const env = loadEnv();
  if (!env.server || !env.adminKey || !env.apiKey) {
    console.error("缺少环境变量。检查 ~/.netclass-drain.env");
    process.exit(1);
  }

  // 1. 拉 pending
  console.log(`拉取 ${limit} 道 pending 题...`);
  const pendingRes = await fetch(
    `${env.server}/admin/pending?limit=${limit}`,
    { headers: { "X-Admin-Key": env.adminKey } },
  );
  if (!pendingRes.ok) {
    console.error(`拉取失败: ${pendingRes.status}`);
    process.exit(1);
  }
  const { items, total_pending } = (await pendingRes.json()) as {
    items: PendingItem[];
    total_pending: number;
  };
  console.log(`队列共 ${total_pending}，拉取 ${items.length} 道\n`);

  // 2. 过滤纯文本可答题
  const drainable = items.filter((q) =>
    (q.tex_spans ?? []).every((s) => s.latex && s.latex.trim()),
  );
  const needVision = items.length - drainable.length;
  console.log(`纯文本可答: ${drainable.length}，需看图: ${needVision}\n`);

  if (drainable.length === 0) {
    console.log("没有可答题。");
    return;
  }

  // 3. 逐题调 DeepSeek
  const answers: Answer[] = [];
  for (let i = 0; i < drainable.length; i++) {
    const q = drainable[i]!;
    const decoded = decodeQuestion(q);
    const qType = q.type ?? 'single';
    console.log(`[${i + 1}/${drainable.length}] ${q.id.slice(0, 8)} [${qType}] — ${decoded.split("\n")[0]!.slice(0, 80)}`);

    if (dryRun) {
      console.log("  [dry-run] 跳过 API 调用\n");
      continue;
    }

    const result = await askDeepSeek(decoded, qType, env.apiKey);
    if (!result || result.raw.length === 0) {
      console.log(`  ❌ API 返回无答案，跳过\n`);
      continue;
    }

    console.log(`  → ${result.value} (${result.rawText.slice(0, 60)})\n`);
    answers.push({
      id: q.id,
      answer: { value: result.value, raw: result.raw },
      confidence: 0.95,
      source: "deepseek-api",
      note: `DS: ${result.rawText.slice(0, 40)}`,
    });
  }

  // 4. 批量提交
  console.log(`---\n提交 ${answers.length} 道答案...`);
  if (answers.length === 0) {
    console.log("无答案可提交。");
    return;
  }

  const submitRes = await fetch(`${env.server}/admin/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": env.adminKey,
    },
    body: JSON.stringify({ answers }),
  });

  const submitJson = (await submitRes.json()) as {
    accepted?: number;
    rejected?: Array<{ id: string; reason: string }>;
  };
  console.log(`✓ 入库: ${submitJson.accepted ?? 0}`);
  const rejected = submitJson.rejected ?? [];
  if (rejected.length > 0) {
    console.log(`✗ 已拒: ${rejected.length}（${[...new Set(rejected.map((r) => r.reason))].join(", ")}）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
