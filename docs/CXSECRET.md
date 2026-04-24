# 超星字体反混淆（cxsecret）

> 超星 `.font-cxsecret` class 用自定义字体把 DOM 里的中文字符映射到另一批 codepoint，人眼看到的是正常字，但爬虫/OCR 抓到的 `innerText` 是乱码。
> 这是超星对第三方答题工具的主要反爬手段。**必须**在 client 端解码后才能上传给服务端，否则同一道题不同客户端会算出不同 hash。

## 1. 原理

```
DOM text:    "已知微抮方程 抦通解为"     ← 爬虫看到
渲染:         "已知微分方程 的通解为"     ← 人眼看到
                      ^             ^
                     抮→分         抦→的
```

超星在题目外层 div 加 `class="font-cxsecret"`，然后通过 `@font-face` 加载一份自定义 ttf 字体。这份字体把某些字符的 glyph 换成了另一个字——比如 U+62EE (抮) 的 glyph 实际画的是"分"。

映射关系是**一一映射**（不是随机的，否则用户无法复制粘贴）。整张表大约 3000-6000 个字符映射。

## 2. 映射表来源

原 `app.js` metadata 里有这行：

```
// @resource ttf https://www.forestpolice.org/ttf/2.0/table.json
```

**关键修正（2026-04-24 实测）**：映射表**不是**"混淆字 → 真实字"的直接查表，而是 `glyph_hash → real_codepoint`。
格式：

```json
{
  "10434866": 23247,
  "10583225": 34076,
  ...
}
```

共 20906 条（355 KB）。Keys 是 `md5(JSON.stringify(glyph_path)).slice(24)`，Values 是目标 Unicode codepoint。

完整算法（见 `app.js:4884-4932` 的 `decrypt`）：

1. 找页面 `<style>` 标签里含 `font-cxsecret` 的 `@font-face`
2. 提 base64 编码的 ttf → ArrayBuffer
3. 用 Typr.js 解析 ttf
4. 遍历 CJK 范围 `U+4E00..U+9FA6`：
   - `font.codeToGlyph(code)` → glyph 对象
   - `font.glyphToPath(glyph)` → SVG path 数组
   - `md5(JSON.stringify(path)).slice(24)` → hash
   - 查 `table[hash]` → 真实 codepoint
   - 构建 `match[code] = realCode`
5. 把 DOM 里 `.font-cxsecret` 元素里每个出现的字符按 `match` 替换
6. 移除 `font-cxsecret` class 避免重复解

## 3. 实装位置

`client/src/decode/cxsecret.ts`:

```typescript
import { Font } from './_vendor/typr-font.js';
import md5 from 'blueimp-md5';
import table from './table.json';

export function buildFontMatch(doc: Document): FontMatchMap {
  // 见文件完整实现
}

export function decryptDocumentInPlace(doc: Document, match: FontMatchMap): void {
  // 原地改 DOM
}

export function decodeCxsecretWithMatch(input: string, match: FontMatchMap): string {
  // 纯函数版，单元测试用
}

export function decryptDocument(doc: Document): FontMatchMap {
  const match = buildFontMatch(doc);
  decryptDocumentInPlace(doc, match);
  return match;
}
```

`client/src/decode/_vendor/typr-font.js` 是从原 `app.js:1775-4883` 原样抽取的
Typr.js + Font 封装（3128 行）。**不要改**——表里的 hash 是按这版 Typr 的 path
序列化算出来的，版本漂移就全失配。

## 4. 更新策略

超星**可能不定期更新**字体表（换 codepoint 对应关系）。应对：

1. **启动时拉表**：客户端启动 `GM_xmlhttpRequest` 拉 `forestpolice.org` 的 table.json，存 `GM_value`（带 TTL 7 天）
2. **自检**：每次解码后把解码结果 hash 上报到 `/telemetry`，服务端统计"解码失败率"（比如解完还有大量中文伪字 `抮` `抦`）。超过阈值自动报警
3. **离线兜底**：表拉失败 → 用 bundle 进脚本里的快照（冻结某个时间点的表）

## 5. 单元测试

`client/test/decode-cxsecret.spec.ts` 覆盖两类：

- **纯函数 `decodeCxsecretWithMatch(input, match)`**：单测时构造 mock match map，
  不依赖真实字体。已跑通 8 条 case。
- **`buildFontMatch(doc)` + `decryptDocument(doc)`**：需要真实 ttf base64 + DOM。
  属于 E2E 范畴，在 `client/test/e2e/extract-chaoxing.spec.ts` 里用 Playwright
  加载 fixture HTML 跑。

## 6. 已知坑

- **首次解耗时 50-200ms**（20906 次 glyph path 遍历 + md5）。调用方应缓存
  「每个页面的字体 → match」，别每道题都重跑
- **表 ≠ 100% 完整**。漏 hash 时那个字符原样保留。**服务端应宽容**：优先用
  超星暴露的 `questionId` 作主键，text hash 作次要去重
- 选项里的图片 alt 文本也可能被混淆过。合图前 `innerText` 都跑一遍解码
- **vendored `_vendor/typr-font.js` 原样不动**。版本漂移 = 全部 hash 失配 = 题库归零

## 7. 反制超星二次反制的预案

如果超星发现 `forestpolice.org` 这份表被广泛用于绕过反爬，可能：

1. 换字体 → 换 codepoint 映射 → **影响**：表失效，全客户端题库 miss。**预案**：`forestpolice` 维护者 24-48h 内更新，OTA 推新表即可
2. 改为**每次请求随机 codepoint**（加盐）→ **影响**：客户端无法用固定表解。**预案**：改成客户端在页面上做 Canvas 光栅化 → OCR 反查，成本高 10 倍但仍可行

**短期（Phase 0-1）不考虑**。预算仅在年度演进计划里留一项"超星反制 v2 应对"。
