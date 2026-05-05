// 数学题合图：N 张小 PNG → 1 张大 PNG
// 规范：docs/VISION-COMPOSE.md
// 样例：docs/recon/vision-samples/q1_options_combined.png

export interface ImgRef {
  url: string;
  role: 'stem' | 'option' | 'extra';
  label?: string; // 选项用，A/B/C/D
}

/**
 * 把一道题的全部图片合成为 1 张 PNG。
 * 返回 Blob（上传时转 base64）。
 */
export async function composeQuestionImage(refs: ImgRef[]): Promise<Blob> {
  const bitmaps = await Promise.all(
    refs.map(async (r) => ({
      ...r,
      bitmap: await fetchImageBitmap(r.url),
    })),
  );

  const stems = bitmaps.filter((b) => b.role === 'stem');
  const opts = bitmaps.filter((b) => b.role === 'option');

  // 放大太小公式图：chaoxing 部分公式图只有 20-60px 宽，drain 看不清
  const MIN_IMG_W = 200;
  const MIN_IMG_H = 60;
  const scaleBitmap = (b: ImageBitmap): { bitmap: ImageBitmap; scale: number } => {
    if (b.width >= MIN_IMG_W && b.height >= MIN_IMG_H) return { bitmap: b, scale: 1 };
    const scale = Math.max(MIN_IMG_W / b.width, MIN_IMG_H / b.height);
    const canvas = new OffscreenCanvas(Math.ceil(b.width * scale), Math.ceil(b.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { bitmap: b, scale: 1 };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
    return { bitmap: canvas.transferToImageBitmap(), scale };
  };

  const scaledStems = stems.map((s) => ({ ...s, ...scaleBitmap(s.bitmap) }));
  const scaledOpts = opts.map((o) => ({ ...o, ...scaleBitmap(o.bitmap) }));

  const stemWidth = scaledStems.reduce((s, b) => s + b.bitmap.width + 20, 40);
  const stemHeight = scaledStems.length
    ? Math.max(...scaledStems.map((b) => b.bitmap.height))
    : 0;

  const optRowHeight = (b: { bitmap: ImageBitmap }) => Math.max(b.bitmap.height, 36) + 40;
  const optHeight = scaledOpts.reduce((s, b) => s + optRowHeight(b), 0);

  const PAD = 40;
  const canvasWidth = Math.max(stemWidth + PAD * 2, 800);
  const canvasHeight = Math.max(stemHeight + PAD * 2 + optHeight + PAD, 200);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 28px sans-serif';

  // 题干区（横排）
  let x = PAD;
  scaledStems.forEach((s) => {
    ctx.drawImage(s.bitmap, x, PAD);
    x += s.bitmap.width + 20;
  });

  // 分隔线
  if (stems.length && scaledOpts.length) {
    const lineY = stemHeight + PAD + 20;
    ctx.strokeStyle = '#CCCCCC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, lineY);
    ctx.lineTo(canvasWidth - PAD, lineY);
    ctx.stroke();
  }

  // 选项区（纵排，左侧标签右侧图）
  let y = stemHeight + PAD + 40;
  scaledOpts.forEach((o, i) => {
    const label = o.label ?? String.fromCharCode(65 + i);
    const labelW = ctx.measureText(label + ':').width;
    ctx.fillText(`${label}:`, PAD, y + o.bitmap.height / 2 + 10);
    ctx.drawImage(o.bitmap, PAD + labelW + 16, y);
    y += optRowHeight(o);
  });

  return await canvas.convertToBlob({ type: 'image/png' });
}

/**
 * 拉公式图。先试普通 fetch — 实测 2026-04 高数课
 * `p.ananas.chaoxing.com` 服务器给 CORS 头，原生 fetch 直接 200。
 * fetch 失败再 fallback GM_xmlhttpRequest（旧版超星 / 其他无 CORS 域）。
 *
 * 这条改动要紧：原方案只走 GM 必须 @connect 白名单，
 * Tampermonkey 加白名单要 user 重装脚本（version 不动则不更新），
 * 实测线上 22 道新题里只 2 道带图就是因为旧装 GM @connect 漏域。
 */
async function fetchImageBitmap(url: string): Promise<ImageBitmap> {
  // 1. 普通 fetch 优先（无 GM 依赖、无 @connect 白名单要求）
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (r.ok) {
      const blob = await r.blob();
      return await createImageBitmap(blob);
    }
    // 200 段以外才 fallback；CORS 失败会直接 throw，由下面 catch 接
  } catch {
    // fallthrough to GM
  }

  // 2. fallback GM_xmlhttpRequest（要 @connect 白名单 + 用户脚本环境）
  return new Promise<ImageBitmap>((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error(`fetch failed and GM_xmlhttpRequest unavailable: ${url}`));
      return;
    }
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      responseType: 'blob',
      onload: async (r) => {
        try {
          const blob = r.response as Blob;
          resolve(await createImageBitmap(blob));
        } catch (e) {
          reject(e);
        }
      },
      onerror: () => reject(new Error(`GM fetch image failed: ${url}`)),
      ontimeout: () => reject(new Error(`GM fetch image timeout: ${url}`)),
      timeout: 10_000,
    });
  });
}

/** Blob → base64 data URL（不含 data: 前缀，纯 base64） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      // strip "data:image/png;base64," prefix
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
