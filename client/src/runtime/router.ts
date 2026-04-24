// URL 模式 → 页面种类分派
//
// 对应旧 app.js:5699-5721：根据 URL 关键字决定执行哪条处理链。
//
// 当前支持：
//   - chaoxing 章节学习页（含视频 + iframe 内 work 模块）
//   - chaoxing 作业页（独立的 /mooc2/work/dowork 路径）
//   - chaoxing 考试页（/exam-ans/exam）
//   - unipus 通用页（Phase 1 Week 2 补）
//   - zhihuishu 考试页（Phase 3 补）

export type PageKind =
  | 'chaoxing-chapter'
  | 'chaoxing-homework'
  | 'chaoxing-exam'
  | 'unipus-page'
  | 'zhihuishu-exam'
  | 'unknown';

interface RouteRule {
  kind: PageKind;
  // host 正则与 path 包含关键字（任一 path 命中即算中）
  host: RegExp;
  pathIncludes: string[];
}

const RULES: RouteRule[] = [
  {
    kind: 'chaoxing-chapter',
    host: /(^|\.)chaoxing\.com$|\.edu\.cn$|\.nbdlib\.cn$|\.hnsyu\.net$|\.gdhkmooc\.com$/,
    pathIncludes: ['/mycourse/studentstudy', '/knowledge/cards'],
  },
  {
    kind: 'chaoxing-homework',
    host: /(^|\.)chaoxing\.com$/,
    pathIncludes: ['/mooc2/work/dowork', '/work/selectWorkQuestionYiPiYue', '/work/addStudentWorkNewWeb'],
  },
  {
    kind: 'chaoxing-exam',
    host: /(^|\.)chaoxing\.com$/,
    pathIncludes: ['/exam-ans/exam', '/exam/test'],
  },
  {
    kind: 'zhihuishu-exam',
    host: /onlineexamh5new\.zhihuishu\.com$/,
    pathIncludes: ['/stuExamWeb', '/examPaper'],
  },
  {
    kind: 'unipus-page',
    host: /(uai|ucontent)\.unipus\.cn$/,
    pathIncludes: ['/'], // 整站都可能是
  },
];

/**
 * 纯函数路由：给一个 URL（或部分字段）返回 PageKind。
 * 便于单测：完全不依赖 window。
 */
export function resolvePageKind(loc: { hostname: string; pathname: string }): PageKind {
  for (const rule of RULES) {
    if (!rule.host.test(loc.hostname)) continue;
    if (rule.pathIncludes.some((kw) => loc.pathname.includes(kw))) {
      return rule.kind;
    }
  }
  return 'unknown';
}

/** 从 window.location 读 */
export function currentPageKind(win: Window = window): PageKind {
  return resolvePageKind({ hostname: win.location.hostname, pathname: win.location.pathname });
}
