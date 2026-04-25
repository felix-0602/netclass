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

  const stemWidth = stems.reduce((s, b) => s + b.bitmap.width + 20, 40);
  const stemHeight = stems.length
    ? Math.max(...stems.map((b) => b.bitmap.height))
    : 0;

  const optRowHeight = (b: { bitmap: ImageBitmap }) => Math.max(b.bitmap.height, 30) + 40;
  const optHeight = opts.reduce((s, b) => s + optRowHeight(b), 0);

  const canvasWidth = Math.max(stemWidth, 800);
  const canvasHeight = Math.max(stemHeight + 80 + optHeight + 80, 200);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 24px sans-serif';

  // 题干区（横排）
  let x = 20;
  stems.forEach((s) => {
    ctx.drawImage(s.bitmap, x, 40);
    x += s.bitmap.width + 20;
  });

  // 分隔线
  if (stems.length && opts.length) {
    ctx.strokeStyle = '#CCCCCC';
    ctx.beginPath();
    ctx.moveTo(20, stemHeight + 60);
    ctx.lineTo(canvasWidth - 20, stemHeight + 60);
    ctx.stroke();
  }

  // 选项区（纵排）
  let y = stemHeight + 80;
  opts.forEach((o, i) => {
    const label = o.label ?? String.fromCharCode(65 + i);
    ctx.fillText(`${label}:`, 40, y + o.bitmap.height / 2 + 8);
    ctx.drawImage(o.bitmap, 120, y);
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
