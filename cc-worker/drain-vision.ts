// drain-vision — Codex 读合成图 → DeepSeek 答题
// 用法：npx tsx cc-worker/drain-vision.ts [--limit N] [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAnswer } from "./lib/deepseek-parser.js";

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

function decodePartial(q: PendingItem): string {
  const texMap = new Map<string, string>();
  for (const s of q.tex_spans ?? []) {
    if (s.latex) texMap.set(s.placeholder, s.latex.trim());
  }
  const replaceTex = (t: string) =>
    t.replace(/<<M\d+>>/g, (m) => texMap.get(m) ?? m);
  let out = replaceTex(q.text);
  for (const o of q.options ?? []) {
    out += `\n  ${o.label}. ${replaceTex(o.text ?? "")}`;
    if (o.image_ref && texMap.has(o.image_ref)) {
      out += ` ${replaceTex(o.image_ref)}`;
    }
  }
  return out;
}

async function askDeepSeek(question: string, type: string, apiKey: string): Promise<{ value: string; raw: string[]; rawText: string } | null> {
  let typeHint: string;
  let systemPrompt: string;
  if (type === 'multi') {
    typeHint = '多选题，请只回复所有正确答案的字母，用逗号分隔（如 A,C），不要任何解释。';
    systemPrompt = '你是一个简洁的高等数学助教。多选题只回复所有正确答案字母，用逗号分隔。';
  } else if (type === 'judge') {
    typeHint = '判断题，请只回复"对"或"错"，不要任何解释。';
    systemPrompt = '你是一个简洁的高等数学助教。判断题只回复"对"或"错"。';
  } else if (type === 'fill') {
    typeHint = '填空题，请只回复填空的答案文本。如果有多个空，用 || 分隔（如 答案1||答案2||答案3），不要任何解释。';
    systemPrompt = '你是一个简洁的高等数学助教。填空题只回复答案文本，多空用 || 分隔。';
  } else {
    typeHint = '单选题，请只回复正确答案的字母（A/B/C/D），不要任何解释。';
    systemPrompt = '你是一个简洁的高等数学助教。只回复正确答案的字母（A/B/C/D），不要任何解释。';
  }

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
        { role: "user", content: `${question}\n\n${typeHint}\n\n答案：` },
      ],
      temperature: 0,
      max_tokens: 30,
    }),
    signal: controller.signal,
  });
  clearTimeout(timer);
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseAnswer(rawText, type);
  if (!parsed) return null;
  return { value: parsed.value, raw: parsed.raw, rawText };
}

function callCodex(imagePath: string): string {
  const prompt = `请读取图片文件 ${imagePath}，这是一道高等数学选择题的合成图。把题目和所有选项完整地转写成中文+LaTeX。直接输出题目，不要解释。`;
  const stdout = execSync(`codex exec "${prompt}"`, {
    timeout: 180000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: "pipe",
  });
  return stdout.toString("utf-8");
}

/** 从 Codex 输出中提取转写文本 */
function parseCodexOutput(output: string): string {
  // Codex 输出格式: user prompt → "codex" → actual response → "codex" blocks → final block
  const blocks = output.split(/^codex$/m).filter((b) => b.trim());
  // 最后一个 codex 块通常包含最终答案
  if (blocks.length >= 2) {
    const last = blocks[blocks.length - 1]!;
    // 去掉 tokens used 等尾部
    return last.replace(/^tokens used[\s\S]*$/m, "").trim();
  }
  return blocks[blocks.length - 1]?.trim() ?? "";
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 5);
  const dryRun = args.includes("--dry-run");

  const env = loadEnv();
  if (!env.server || !env.adminKey || !env.apiKey) {
    console.error("缺少环境变量。检查 ~/.netclass-drain.env");
    process.exit(1);
  }

  // 1. 拉 pending
  console.log(`拉取 ${limit} 道有合成图的 pending 题...`);
  const pendingRes = await fetch(`${env.server}/admin/pending?limit=${limit * 3}`, {
    headers: { "X-Admin-Key": env.adminKey },
  });
  const { items, total_pending } = (await pendingRes.json()) as {
    items: PendingItem[];
    total_pending: number;
  };
  const withImg = (items as PendingItem[]).filter((q) => q.composite_image_url).slice(0, limit);
  console.log(`队列共 ${total_pending}，有图 ${withImg.length} 道\n`);

  if (withImg.length === 0) {
    console.log("没有带合成图的题。");
    return;
  }

  const answers: Array<{
    id: string;
    answer: { value: string; raw: string[] };
    confidence: number;
    source: string;
    note: string;
  }> = [];

  for (let i = 0; i < withImg.length; i++) {
    const q = withImg[i]!;
    const imgUrl = q.composite_image_url!;
    const imgPath = join(tmpdir(), `nc-vision-${q.id.slice(0, 8)}.png`);

    console.log(`[${i + 1}/${withImg.length}] ${q.id.slice(0, 8)} — ${(q.text ?? "").slice(0, 60)}`);

    try {
      // 下载图
      console.log("  下载合成图...");
      const imgRes = await fetch(imgUrl);
      if (!imgRes.ok) { console.log("  ❌ 下载失败"); continue; }
      writeFileSync(imgPath, Buffer.from(await imgRes.arrayBuffer()));

      if (dryRun) {
        console.log("  [dry-run] 跳过 Codex + DeepSeek\n");
        continue;
      }

      // Codex 读图
      console.log("  Codex 读图中...");
      const codexRaw = callCodex(imgPath);
      const transcribed = parseCodexOutput(codexRaw);

      // 拼接：部分已知文本 + Codex 转写
      const partial = decodePartial(q);
      const fullQ = transcribed || partial;
      console.log(`  转写: ${fullQ.split("\n")[0]!.slice(0, 100)}`);

      // DeepSeek 答题
      console.log("  DeepSeek 答题中...");
      const qType = q.type ?? 'single';
      const dsResult = await askDeepSeek(fullQ, qType, env.apiKey);
      if (!dsResult || dsResult.raw.length === 0) {
        console.log("  ❌ API 返回无答案");
      } else {
        console.log(`  → ${dsResult.value} (${dsResult.rawText.slice(0, 40)})`);
        answers.push({
          id: q.id,
          answer: { value: dsResult.value, raw: dsResult.raw },
          confidence: 0.92,
          source: "codex+deepseek",
          note: `Codex转录: ${transcribed.slice(0, 30)}`,
        });
      }
    } catch (e: any) {
      console.log(`  ❌ 错误: ${e.message?.slice(0, 80)}`);
    }
    console.log();
  }

  // 提交
  console.log(`---\n提交 ${answers.length} 道答案...`);
  if (answers.length === 0) { console.log("无答案"); return; }

  const submitRes = await fetch(`${env.server}/admin/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": env.adminKey },
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
