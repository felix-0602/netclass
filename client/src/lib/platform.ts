// 根据当前页面 hostname 识别平台

export type Platform = 'chaoxing' | 'zhihuishu' | 'unipus';

const HOST_RULES: Array<[RegExp, Platform]> = [
  [/\.chaoxing\.com$/, 'chaoxing'],
  [/\.zhihuishu\.com$/, 'zhihuishu'],
  [/onlineexamh5new\.zhihuishu\.com$/, 'zhihuishu'],
  [/\.unipus\.cn$/, 'unipus'],
  // 部分大学域名承载超星（见原 app.js @match）
  [/\.nbdlib\.cn$/, 'chaoxing'],
  [/\.hnsyu\.net$/, 'chaoxing'],
  [/\.gdhkmooc\.com$/, 'chaoxing'],
  [/\.edu\.cn$/, 'chaoxing'], // 可能承载超星或其他，细分延后
];

export function detectPlatform(hostname: string): Platform | null {
  for (const [re, p] of HOST_RULES) {
    if (re.test(hostname)) return p;
  }
  return null;
}
