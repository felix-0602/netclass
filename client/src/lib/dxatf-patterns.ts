// 大学搜题酱 Chrome 扩展 v1.16.2 可复用模式参考
// 仅提取架构模式和设计参考，不含原扩展专有代码

// ============================================================
// 平台 URL 匹配表 — 参考 SiteKey + SITE_ROOT_DOMAINS
// ============================================================

export const PLATFORM_DOMAINS: Record<string, string[]> = {
  chaoxing: ['chaoxing.com', 'xuexitong.com'],
  zhihuishu: ['zhihuishu.com'],
  yuketang: ['yuketang.cn'],
  icve: ['icve.com.cn'],
  mooc: ['icourse163.org'],
  xuetangx: ['xuetangx.com'],
} as const;

/** 根据 hostname 识别平台，复用大学搜题酱的后缀匹配策略 */
export function matchPlatformByHost(hostname: string): string | null {
  if (!hostname) return null;
  for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
    if (domains.some((d) => hostname === d || hostname.endsWith('.' + d))) {
      return platform;
    }
  }
  return null;
}

// ============================================================
// AppEvent 事件总线模式参考
// 大学搜题酱用 36 个自定义事件解耦 SideBar 内部组件通信
// 我们项目的对应物：runtime/state.ts 的 patchRuntimeState + addRuntimeLog
// ============================================================

/**
 * 大学搜题酱 AppEvent 分类：
 *
 * UI 事件: ScrollToBottom, ChangeShowContextMenu, CloseHistory, ShowToastText
 * 用户事件: UserNameChange, FillTextArea, UnderlineWordChat, ToSendScreenshot
 * AI 对话: InsertMessage, ReplyRecognition, AiSearchManualStop, ReloadAiChat
 * 刷题控制: StartTask, StopTask, StartExam, StopExam, StartBrushCourse
 * VIP 事件: VIP_PAY_SUCCESS, OPENVIP, VipTrialExpired, VipTrialClaimed
 *
 * 设计启示：用事件名代替直接函数调用，让 Panel/Adapter/Runner 解耦。
 * 当前项目 runtime/state.ts 的 registerRuntimeActions 已经起到了类似作用。
 */

// ============================================================
// SSE 协议格式参考
// ============================================================

/**
 * 大学搜题酱 SSE 生命周期:
 *   CreateSSE → SSEOpen → SSEData/SSEQuestion → SSEClose
 *   异常路径: SSEError → SSEClose
 *
 * 架构要点:
 *   1. background service worker 作为 SSE 客户端（避免 content script 断连）
 *   2. content script 通过 chrome.runtime.sendMessage 桥接
 *   3. 每个题目以 SSEQuestion 事件推送
 *
 * 当前项目: server/src/routes/answer.ts 用 request-response，
 *   未来可升级为 SSE 流式，参考这个生命周期模型。
 */

export interface SSELifecycleEvent {
  type: 'open' | 'data' | 'question' | 'error' | 'close';
  payload?: unknown;
}

// ============================================================
// OCR 截图搜题流程参考
// ============================================================

/**
 * 大学搜题酱截图搜题四阶段:
 *   1. 快捷键捕获 (chrome.commands Alt+C)
 *   2. 裁剪交互 (InitCut → Cut → Capture)
 *   3. 图片提取 (canvas.toDataURL 或 chrome.tabs.captureVisibleTab)
 *   4. 搜索提交 (FetchPicSearch 发送 base64 到服务端)
 *
 * 状态枚举:
 *   SEARCH_STATUS:  RESET(-2) → LOADING(-1) → SUCCESS(0) / UNLOGIN(3) / OCR_FAILURE(905000)
 *   BRUSH_STATUS:   INIT(-3) → OCR_FAILURE(-4) / OFFLINE(-6)
 *
 * 设计启示:
 *   - 所有"加载中/初始"状态用负数，成功/错误码用零或正数
 *   - 当前项目 vision/compose.ts 的 composeQuestionImage 已覆盖阶段3
 *   - 阶段4 可通过现有 /answer 路由扩展支持图片
 */

// ============================================================
// 编辑器注入双层通信模式 — 适用于 ICVE/学堂在线
// ============================================================

/**
 * 当页面使用 TinyMCE / UEditor 等富文本编辑器时:
 *   1. content script 以 world: MAIN 注入（manifest 声明）
 *   2. MAIN world 脚本通过 window.postMessage 与 ISOLATED world 通信
 *   3. MAIN world 直接调用 window.tinymce / window.UE 等宿主 API
 *   4. 每次 setContent 后触发完整事件链: change → input → save → focus → blur
 *
 * 当前项目已有类似模式: adapters/unipus.ts 的 fillUnipusAnswer
 */

// ============================================================
// 按平台分片的 Content Script 架构
// ============================================================

/**
 * 大学搜题酱的 content_scripts 设计:
 *   - 每个平台一个独立 content script (cx / zhsIndex / icveWorkEditor / xtOnline)
 *   - 通用 UI (SideBar) 注入所有页面
 *   - manifest 按 matches 精确分发
 *
 * 当前项目的对应实现: adapters/ 目录下的 chaoxing.ts / unipus.ts
 * 智慧树 (zhihuishu) adapter 目前是占位，可参考 zhsIndex 的 DOM selector 模式补齐。
 */

// ============================================================
// API 端点参考（仅用于理解功能边界，不直接调用）
// ============================================================

export const DXATF_API_PATTERNS = {
  /** 认证服务 */
  auth: 'https://passport.daxuesoutijiang.com',
  /** 主站 API */
  main: 'https://www.daxuesoutijiang.com',
  /** 日志上报 */
  log: 'https://nlog.daxuesoutijiang.com/log/h5_daxuesouti',
} as const;

// ============================================================
// 状态机枚举模式 — 负数表示进行中/初始
// ============================================================

/**
 * 大学搜题酱状态值约定:
 *   负数 = 初始化/加载中/失败
 *   零 = 成功
 *   正数 = 特定状态码
 *
 * 当前项目 runtime/state.ts 的 RuntimeState.status
 *   已采用类似模式: 'idle' | 'working' | 'paused' | 'error'
 */
