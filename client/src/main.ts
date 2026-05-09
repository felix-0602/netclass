// Netclass Sidekick — 客户端入口
// @match 范围内任何页面加载完成后触发

import { detectPlatform } from './lib/platform';
import { bootChaoxing } from './adapters/chaoxing';
import { bootUnipus } from './adapters/unipus';
import { runFiller } from './answer/filler';
import {
  courseProgress,
  onUrlChangeWhileRunning,
  pauseCourseRunner,
  runChapter,
  startCourseRunner,
  stopCourseRunner,
} from './runtime/course-runner';
import { dispatchIframes } from './runtime/iframe-dispatch';
import { detectAndConfirmPopup } from './runtime/popup-handler';
import { currentPageKind } from './runtime/router';
import { registerRuntimeActions, runtimeState } from './runtime/state';
import { processBook, processPptReader } from './runtime/task-handlers';
import { watchInnerIframeUrls, watchUrl } from './runtime/url-watcher';
import { mountPanel } from './ui/mount';

const BOOT_FLAG = '__netclassSidekickBooted__';

function isTopFrame(): boolean {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

function boot() {
  const bootState = globalThis as typeof globalThis & Record<string, boolean | undefined>;
  if (bootState[BOOT_FLAG]) {
    console.info('[netclass-sidekick] skip boot - already booted in this frame');
    return;
  }
  bootState[BOOT_FLAG] = true;

  // 超星页面会在多层 iframe 中重复注入 userscript；adapter 自己会递归处理同源 iframe，
  // 所以只需要顶层 frame 启动一次，避免重复挂监听和重复执行。
  if (!isTopFrame()) {
    console.info('[netclass-sidekick] skip boot - not top frame');
    return;
  }

  const platform = detectPlatform(location.hostname);

  // 仅在我们识别的平台上激活，避免在学校门户等无关页面启动
  if (!platform) return;

  console.info(`[netclass-sidekick] booting on ${platform}`);

  switch (platform) {
    case 'chaoxing':
      bootChaoxing();
      break;
    case 'unipus':
      bootUnipus();
      break;
    case 'zhihuishu':
      // Phase 3 adapter，当前占位
      console.info('[netclass-sidekick] 知到 adapter 尚未实现（Phase 3）');
      break;
  }

  // 挂悬浮 Panel + rehydrate 已存的 JWT
  mountPanel({ platform });

  // 把 runtime actions 注册好，让 Panel 上的按钮能触发
  registerRuntimeActions({
    manualScan: () => void scanCurrent(document, { force: true }),
    toggleAutomation: (enabled: boolean) => {
      console.info('[netclass-sidekick] automation:', enabled);
      if (!enabled) stopCourseRunner();
    },
    startCourse: () => startCourseRunner(document),
    pauseCourse: () => pauseCourseRunner(),
    stopCourse: () => stopCourseRunner(),
  });

  // 自动链路：首次 boot 后 + URL 变化 → 跑当前章节
  // - automationEnabled=true（默认）：runChapter（含 auto-jump）
  // - 手动扫描（Panel 按钮）：dispatchIframes only（不 jump）
  scheduleAutoScan(2500, 'initial boot');
  watchUrl(
    (url, prev) => {
      console.info(`[netclass-sidekick] URL change: ${prev} → ${url}`);
      // course-runner 在跑就让它接续，否则走标准 auto-scan
      if (courseProgress.active) {
        setTimeout(() => onUrlChangeWhileRunning(document), 4000);
      } else {
        scheduleAutoScan(2500, 'url change');
      }
    },
    { intervalMs: 2000 },
  );

  // 内层 iframe 监听 — chaoxing 部分场景（cards iframe 切 num=）只动 iframe src 不动 top URL，
  // 不监听就漏。
  watchInnerIframeUrls(
    ({ src, prevSrc }) => {
      console.info(`[netclass-sidekick] inner iframe src: ${prevSrc} → ${src}`);
      if (courseProgress.active) {
        setTimeout(() => onUrlChangeWhileRunning(document), 4000);
      } else {
        scheduleAutoScan(2500, 'inner iframe change');
      }
    },
    { intervalMs: 2000 },
  );

  // 周期检测 chaoxing 弹窗（"未完成任务"等），自动放行 — 仅在 automation 开启时
  setInterval(() => {
    if (!runtimeState.automationEnabled) return;
    const r = detectAndConfirmPopup(document);
    if (r.status === 'confirmed') {
      console.info(`[netclass-sidekick] auto-confirmed popup (${r.container} → ${r.confirm})`);
    }
  }, 3000);
}

let _autoScanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoScan(delayMs: number, reason: string): void {
  if (_autoScanTimer) clearTimeout(_autoScanTimer);
  _autoScanTimer = setTimeout(() => {
    _autoScanTimer = null;
    console.info(`[netclass-sidekick] auto-scan (${reason}) kind=${currentPageKind()}`);
    void scanCurrent(document, { force: false });
  }, delayMs);
}

/**
 * 当前章节扫一次：
 *   - force=true（手动按"扫描"）：只跑 handler，不 auto-jump
 *   - automationEnabled=true（默认）：runChapter（handler + jumpNext）
 *   - automationEnabled=false：完全跳过
 */
async function scanCurrent(
  rootDoc: Document,
  opts: { force: boolean },
): Promise<void> {
  if (!opts.force && !runtimeState.automationEnabled) {
    console.info('[netclass-sidekick] auto-scan skipped — automation OFF');
    return;
  }

  const kind = currentPageKind();

  if (opts.force) {
    // U 校园：SPA 无 iframe，直接在当前 doc 上跑 filler
    if (kind === 'unipus-page') {
      console.info('[netclass-sidekick] unipus manual scan — running filler directly');
      await runFiller(rootDoc);
      return;
    }

    // 手动模式：只 dispatch，不 jump
    await dispatchIframes(rootDoc, {
      onWork: async (meta) => {
        const doc = (meta.iframe as HTMLIFrameElement).contentDocument;
        if (!doc) return;
        console.info(
          `[netclass-sidekick] runFiller on work iframe: ${meta.src.slice(0, 80)}`,
        );
        await runFiller(doc);
      },
      onDocumentReader: async (meta) => {
        await processPptReader(meta.iframe);
      },
      onEbook: async (meta) => {
        await processBook(meta.iframe);
      },
    });
    return;
  }

  // 自动模式：跑整章 + auto-jump
  await runChapter(rootDoc);
}

// document-start 时 DOM 还没准备，等 DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
