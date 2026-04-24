# 数学题视觉合图规范（Vision Compose）

> 超星数学题目 100% 用图片呈现公式（`p.ananas.chaoxing.com/star3/origin/*.png`）。
> 单道题 5-7 张小图（题干 + 4-5 选项 + 1-2 附件）。
> 如果每张图单独上服务端调 Vision，成本高、延迟长、R2 对象数爆。
>
> 正确做法：**客户端 Canvas 把所有图合成 1 张大 PNG**，一次传输，一次推理。

## 1. 布局规范

合成图**必须**长这样，drain-netclass 的 Claude Code 才能稳定识别：

```
+------------------------------------------------------+
|                  题干图拼接区                          |  ← 有多张题干图时横向拼
|  [IMG1]  [IMG2]                                      |
+------------------------------------------------------+
|                  选项区（纵向）                        |
|  A:  [optA_img]                                      |
|  B:  [optB_img]                                      |
|  C:  [optC_img]                                      |
|  D:  [optD_img]                                      |
+------------------------------------------------------+
```

**关键约束**：
- 每张原图按**原像素尺寸**贴（不要缩放，否则小公式糊）
- 题干区横向排列，间距 20px
- 选项区纵向，每行 Label (`A:` `B:`) + 原图，间距 40px
- 背景纯白 `#FFFFFF`（便于 Vision 模型识别）
- 标签字体 `bold sans-serif 24px`，黑色
- 若题干有多处 `<<Mx>>` 占位符，按占位符顺序横排并在每张图下标注 `M1` `M2`

## 2. `client/src/vision/compose.ts` 实现骨架

```typescript
type ImgRef = { url: string; role: 'stem' | 'option' | 'optLabel' | 'extra'; label?: string };

export async function composeQuestionImage(refs: ImgRef[]): Promise<Blob> {
  // 1. 下载所有图为 ImageBitmap（用 GM_xmlhttpRequest 带正确 referer）
  const bitmaps = await Promise.all(refs.map(async r => ({
    ...r,
    bitmap: await fetchImageBitmap(r.url),
  })));

  // 2. 计算画布尺寸
  const stems = bitmaps.filter(b => b.role === 'stem');
  const opts = bitmaps.filter(b => b.role === 'option');
  const stemWidth = stems.reduce((s, b) => s + b.bitmap.width + 20, 0);
  const stemHeight = Math.max(...stems.map(b => b.bitmap.height));
  const optHeight = opts.reduce((s, b) => s + Math.max(b.bitmap.height, 30) + 40, 0);
  const canvasWidth = Math.max(stemWidth, 800);
  const canvasHeight = stemHeight + 80 + optHeight + 80;

  // 3. 画
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 24px sans-serif';

  // 题干
  let x = 20;
  stems.forEach(s => {
    ctx.drawImage(s.bitmap, x, 40);
    x += s.bitmap.width + 20;
  });

  // 分隔线
  ctx.strokeStyle = '#CCCCCC';
  ctx.beginPath();
  ctx.moveTo(20, stemHeight + 60);
  ctx.lineTo(canvasWidth - 20, stemHeight + 60);
  ctx.stroke();

  // 选项
  let y = stemHeight + 80;
  opts.forEach((o, i) => {
    const label = o.label ?? String.fromCharCode(65 + i);
    ctx.fillText(`${label}:`, 40, y + o.bitmap.height / 2 + 8);
    ctx.drawImage(o.bitmap, 120, y);
    y += Math.max(o.bitmap.height, 30) + 40;
  });

  // 4. 导出 PNG blob
  return await canvas.convertToBlob({ type: 'image/png' });
}

async function fetchImageBitmap(url: string): Promise<ImageBitmap> {
  // 用 GM_xmlhttpRequest 以 responseType='blob'
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      responseType: 'blob',
      onload: async (r) => {
        try {
          resolve(await createImageBitmap(r.response as Blob));
        } catch (e) { reject(e); }
      },
      onerror: reject,
    });
  });
}
```

## 3. 体积上限

- 单张合成图目标 ≤500 KB（PNG 压缩后）
- 最大 ≤2 MB（服务端 `/answer` 拒绝 >5 MB 的 payload）
- 若原图累计 >2 MB：分两批提交，服务端合并

## 4. 服务端存储

- 合成图 bytes → R2 key `stitched/<question_hash>.png`
- R2 bucket **公共可读**（无 referer 校验），cc-worker 可直接 curl
- URL: `https://pub-<bucketId>.r2.dev/stitched/<question_hash>.png`

## 5. cc-worker 侧读图

drain-netclass.md 运行时：

```bash
# 1. 从 pending 里拿到 image_url
curl -o /tmp/q_<hash>.png "$COMPOSITE_IMAGE_URL"

# 2. Claude Code 的 Read 工具直接读本地文件（支持 png）
# 在 markdown 里写：Read 工具调用 /tmp/q_<hash>.png
```

## 6. 验证样本

实际案例见 `docs/recon/vision-samples/q1_options_combined.png` — 就是按本规范合成的 5 选项图。Vision 识别 100% 准确（[recon 报告](./recon/reconnaissance-2026-04-24.md#更新-1vision-识别探针结果2026-04-24-同日完成)）。

## 7. 文字题（纯中文/英文）不合图

只有 `tex_spans.length > 0` 或 `options[i].image_ref` 存在时才走合图。纯文本题走文字通道（上传 `text + options_json`），成本 10 倍低。

## 8. 未来扩展（defer）

- Phase 2：多选题、拖拽排序题需要更复杂的占位符拼图
- Phase 2：U 校园听力题需要音频 → STT，不是 vision 范畴（见 `ANTI-DETECTION.md`）
- Phase 3：题库可选上传"原图压缩版"（比如 WebP 65% 质量），省 R2 存储
