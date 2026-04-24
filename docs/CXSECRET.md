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

这是第三方维护的已经逆向出来的映射表 JSON 文件。格式大约是：

```json
{
  "抮": "分",
  "抦": "的",
  "抧": "初",
  "抨": "值",
  "抩": "满",
  "抪": "条件",  // 可能多字符映射
  ...
}
```

## 3. 实装位置

`client/src/decode/cxsecret.ts`:

```typescript
import table from './table.json';

/**
 * 解超星 font-cxsecret 字体混淆
 * @param node DOM 节点或其 innerText
 * @returns 解码后的纯文本
 */
export function decodeCxsecret(input: string): string {
  let out = '';
  // 遍历每个字符（注意：表里有多字符映射 key，需要贪婪匹配）
  let i = 0;
  while (i < input.length) {
    // 先尝试 2 字符 key（表里偶尔有）
    if (i + 1 < input.length) {
      const two = input.substring(i, i + 2);
      if (two in table) {
        out += (table as any)[two];
        i += 2;
        continue;
      }
    }
    const one = input[i];
    out += one in table ? (table as any)[one] : one;
    i += 1;
  }
  return out;
}

/**
 * 判断一个 DOM 节点是否需要解码（是否 font-cxsecret）
 */
export function needsDecode(el: Element): boolean {
  // 向上查 font-cxsecret class
  let cur: Element | null = el;
  while (cur) {
    if (cur.classList?.contains('font-cxsecret')) return true;
    cur = cur.parentElement;
  }
  return false;
}
```

## 4. 更新策略

超星**可能不定期更新**字体表（换 codepoint 对应关系）。应对：

1. **启动时拉表**：客户端启动 `GM_xmlhttpRequest` 拉 `forestpolice.org` 的 table.json，存 `GM_value`（带 TTL 7 天）
2. **自检**：每次解码后把解码结果 hash 上报到 `/telemetry`，服务端统计"解码失败率"（比如解完还有大量中文伪字 `抮` `抦`）。超过阈值自动报警
3. **离线兜底**：表拉失败 → 用 bundle 进脚本里的快照（冻结某个时间点的表）

## 5. 单元测试（必写）

`test/e2e/decode-cxsecret.spec.ts`：

```typescript
import { decodeCxsecret } from '../../client/src/decode/cxsecret';

test('recon fixture: 高数 Q1 题干解码', () => {
  const obfuscated = '已知微抮方程  抦通解为 ，抩抨足抧值抰抪';
  const expected = '已知微分方程  的通解为 ，满足初值条件';
  expect(decodeCxsecret(obfuscated)).toBe(expected);
});

test('不含 font-cxsecret 的文本原样返回', () => {
  expect(decodeCxsecret('已知微分方程')).toBe('已知微分方程');
});

test('英文字符不混淆，直接透传', () => {
  expect(decodeCxsecret('The Grand Canal')).toBe('The Grand Canal');
});
```

## 6. 已知坑

- 表不保证完整。漏字时 `decodeCxsecret` 会原样透传该字符，这会导致 hash 不稳定。**服务端应宽容**：同一 questionId 允许有 2-3 个不同 hash（超星 questionId 是稳定主键），hash 仅作次要去重
- 多字符 key 的贪婪匹配要小心：如 `"抪"` 映射到 `"条件"`（1→2），直接替换后字符串长度变了，position 计算要注意
- 选项里的图片 alt 文本也可能被混淆过。合图前**全部解一遍**

## 7. 反制超星二次反制的预案

如果超星发现 `forestpolice.org` 这份表被广泛用于绕过反爬，可能：

1. 换字体 → 换 codepoint 映射 → **影响**：表失效，全客户端题库 miss。**预案**：`forestpolice` 维护者 24-48h 内更新，OTA 推新表即可
2. 改为**每次请求随机 codepoint**（加盐）→ **影响**：客户端无法用固定表解。**预案**：改成客户端在页面上做 Canvas 光栅化 → OCR 反查，成本高 10 倍但仍可行

**短期（Phase 0-1）不考虑**。预算仅在年度演进计划里留一项"超星反制 v2 应对"。
