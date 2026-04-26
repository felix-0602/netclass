import { beforeEach, describe, expect, test } from 'vitest';
import { createTestCtx, type TestCtx } from './_helpers';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

let ctx: TestCtx;

beforeEach(() => {
  ctx = createTestCtx();
  const now = Math.floor(Date.now() / 1000);
  // seed 5 类样本
  const rows: Array<[string, string, string, string, string, string, string | null, number]> = [
    // 1. 数学题缺图
    ['hash-math-noimg', 'chaoxing', 'single', '已知微分方程 <<M1>> 的通解为 <<M2>>', '[]', '[]', null, now],
    // 2. 选项全空
    ['hash-empty-opts', 'chaoxing', 'single', '下列关于齐次微分方程的说法中正确的是', '[{"label":"A","text":null},{"label":"B","text":null}]', '[]', null, now],
    // 3. 题干太短
    ['hash-short', 'chaoxing', 'single', '阶数', '[{"label":"A","text":"1"}]', '[]', null, now],
    // 4. 太老
    ['hash-old', 'chaoxing', 'single', '正常题干文本足够长不会被 short_text 命中', '[{"label":"A","text":"答案A"}]', '[]', null, now - 60 * 86400],
    // 5. 健康题（不该被清）
    ['hash-good', 'chaoxing', 'single', '正常题干文本完整可答', '[{"label":"A","text":"答案A"},{"label":"B","text":"答案B"}]', '[]', null, now],
    // 6. v2: 含 <<M>> 占位但 tex_spans 有 latex 文本 — drain 可读，不该清
    ['hash-math-with-latex', 'chaoxing', 'single', '已知微分方程 <<M1>> 的通解为 <<M2>>', '[{"label":"A","text":"答案A"},{"label":"B","text":"答案B"}]', '[{"placeholder":"<<M1>>","latex":"y\'=2x","image_idx":0},{"placeholder":"<<M2>>","latex":"y=x^2+C","image_idx":1}]', null, now],
    // 7: v3 实测命中 prod bug — 选项 text 全 null 但有 image_ref 指向 latex 文本，drain 可读，**不该**清
    ['hash-empty-opts-but-latex', 'chaoxing', 'single', '【单选题】下列哪个是 <<M1>> 的通解？', '[{"label":"A","text":null,"image_ref":"<<M2>>"},{"label":"B","text":null,"image_ref":"<<M3>>"}]', '[{"placeholder":"<<M1>>","latex":"y\'=2x","image_idx":0},{"placeholder":"<<M2>>","latex":"y=x^2+C","image_idx":1},{"placeholder":"<<M3>>","latex":"y=2x+C","image_idx":2}]', null, now],
    // 8: v4 prod hit — 题面短 (cxsecret strip 后 < 10 字) + 占位符 + tex_spans latex 完整 → 旧 short_text 误判，新版加 latex 长度算总长不命中
    ['hash-short-but-latex-long', 'chaoxing', 'single', '1 【单选题】<<M1>>', '[{"label":"A","text":"是"},{"label":"B","text":"不是"}]', '[{"placeholder":"<<M1>>","latex":"y\'\'=1+y\'^2 求通解","image_idx":0}]', null, now],
  ];
  for (const [id, platform, qtype, text, opts, tex, image_key, created] of rows) {
    ctx.env.rawDb
      .prepare(
        `INSERT INTO pending_q (id, platform, q_type, text, options_json, tex_spans_json, image_key, context_json, priority, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)`,
      )
      .run(id, platform, qtype, text, opts, tex, image_key, created);
  }
});

async function callCleanup(body: object): Promise<Response> {
  return ctx.fetch('/admin/cleanup-broken', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': ADMIN_KEY,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /admin/cleanup-broken', () => {
  test('dry_run 默认 true — 不删，只返回 matched 列表', async () => {
    const res = await callCleanup({});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dry_run: boolean; matched: number; deleted: number; samples: Array<{ id: string; reason: string }> };
    expect(json.dry_run).toBe(true);
    expect(json.deleted).toBe(0);
    expect(json.matched).toBe(4); // math-noimg + empty-opts + short + old（with-latex / opts-but-latex 都不算）
    const reasons = json.samples.map((s) => s.reason).sort();
    expect(reasons).toContain('missing_image_for_math');
    expect(reasons).toContain('empty_options');
    expect(reasons).toContain('short_text');
    expect(reasons).toContain('very_old');
    // good 题不该出现
    expect(json.samples.every((s) => s.id !== 'hash-good')).toBe(true);
    // v2: 含 <<M>> 但 tex_spans 有 latex 文本的题不该出现
    expect(json.samples.every((s) => s.id !== 'hash-math-with-latex')).toBe(true);
    // v3: 选项 text 全 null 但 image_ref 指向 latex 文本的题也不该出现
    expect(json.samples.every((s) => s.id !== 'hash-empty-opts-but-latex')).toBe(true);
    // v4: 题面短但 latex 文本长的题也不该被 short_text 误判
    expect(json.samples.every((s) => s.id !== 'hash-short-but-latex-long')).toBe(true);

    // 数据库里仍是 8 行
    const cnt = ctx.env.rawDb.prepare('SELECT COUNT(*) AS n FROM pending_q').get() as { n: number };
    expect(cnt.n).toBe(8);
  });

  test('dry_run=false 真删', async () => {
    const res = await callCleanup({ dry_run: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dry_run: boolean; deleted: number };
    expect(json.dry_run).toBe(false);
    expect(json.deleted).toBe(4);

    const remain = ctx.env.rawDb
      .prepare('SELECT id FROM pending_q ORDER BY id')
      .all() as Array<{ id: string }>;
    // good + math-with-latex + empty-opts-but-latex + short-but-latex-long 都该留
    expect(remain.map((r) => r.id).sort()).toEqual([
      'hash-empty-opts-but-latex',
      'hash-good',
      'hash-math-with-latex',
      'hash-short-but-latex-long',
    ]);
  });

  test('criteria 单选 — 只清缺图数学题', async () => {
    const res = await callCleanup({ dry_run: false, criteria: ['missing_image_for_math'] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { deleted: number };
    expect(json.deleted).toBe(1);

    const remain = ctx.env.rawDb
      .prepare('SELECT id FROM pending_q ORDER BY id')
      .all() as Array<{ id: string }>;
    expect(remain.map((r) => r.id).sort()).toEqual([
      'hash-empty-opts',
      'hash-empty-opts-but-latex',
      'hash-good',
      'hash-math-with-latex',
      'hash-old',
      'hash-short',
      'hash-short-but-latex-long',
    ]);
  });

  test('v3 BUG fix: empty_options 不误判带 image_ref + latex 文本的题', async () => {
    const res = await callCleanup({ dry_run: true, criteria: ['empty_options'] });
    const json = (await res.json()) as { matched: number; samples: Array<{ id: string }> };
    expect(json.matched).toBe(1); // 只命中 hash-empty-opts（text 真空 + image_ref 也空）
    expect(json.samples[0].id).toBe('hash-empty-opts');
  });

  test('v4 BUG fix: short_text 不误判 latex 文本长的题', async () => {
    // prod 实测：题面 "1 【单选题】<<M1>>" strip 后只 6 字符，但 latex y\'\'=1+y\'^2 完整可读
    const res = await callCleanup({ dry_run: true, criteria: ['short_text'] });
    const json = (await res.json()) as { matched: number; samples: Array<{ id: string }> };
    expect(json.matched).toBe(1); // 只命中 hash-short（text=阶数 + 0 latex）
    expect(json.samples[0].id).toBe('hash-short');
  });

  test('v2: <<M>> + tex_spans latex 非 null → missing_image_for_math 不命中', async () => {
    // 单独锁这条防回归
    const res = await callCleanup({ dry_run: true, criteria: ['missing_image_for_math'] });
    const json = (await res.json()) as { matched: number; samples: Array<{ id: string }> };
    expect(json.matched).toBe(1); // 只命中 hash-math-noimg（tex_spans=[]）
    expect(json.samples[0].id).toBe('hash-math-noimg');
  });

  test('鉴权 — 缺 X-Admin-Key 返 401/403', async () => {
    const res = await ctx.fetch('/admin/cleanup-broken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect([401, 403]).toContain(res.status);
  });

  test('matched=0 时 deleted=0 不报错', async () => {
    // 清光所有
    ctx.env.rawDb.prepare('DELETE FROM pending_q').run();
    const res = await callCleanup({ dry_run: false });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { matched: number; deleted: number };
    expect(json.matched).toBe(0);
    expect(json.deleted).toBe(0);
  });

  test('days_old 自定义阈值', async () => {
    // 默认 30 天阈值会命中 hash-old (60 天)。改成 90 天就不命中
    const res = await callCleanup({
      dry_run: true,
      criteria: ['very_old'],
      days_old: 90,
    });
    const json = (await res.json()) as { matched: number };
    expect(json.matched).toBe(0);
  });
});
