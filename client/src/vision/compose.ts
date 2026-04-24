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
 * 用 GM_xmlhttpRequest 获取图片（自动带 referer = 当前页）。
 * 不用原生 fetch 因为 p.ananas.chaoxing.com 有 referer 校验。
 */
function fetchImageBitmap(url: string): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
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
      onerror: () => reject(new Error(`fetch image failed: ${url}`)),
      ontimeout: () => reject(new Error(`fetch image timeout: ${url}`)),
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
