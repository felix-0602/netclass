// Netclass Sidekick — 客户端入口
// @match 范围内任何页面加载完成后触发

import { detectPlatform } from './lib/platform';
import { bootChaoxing } from './adapters/chaoxing';
import { bootUnipus } from './adapters/unipus';
import { runFiller } from './answer/filler';
import { dispatchIframes } from './runtime/iframe-dispatch';
import { currentPageKind } from './runtime/router';
import { registerRuntimeActions, runtimeState } from './runtime/state';
import { watchUrl } from './runtime/url-watcher';
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

  // 把 runtime actions 注册好，让 Panel 上的"扫描"按钮能触发
  registerRuntimeActions({
    manualScan: () => void scanAndFill(document, { force: true }),
    toggleAutomation: () => {
      // Panel 已直接修改 runtimeState.automationEnabled，这里只是 log
      console.info('[netclass-sidekick] automation:', runtimeState.automationEnabled);
    },
  });

  // 自动链路：首次 boot 后 + URL 变化 → 扫 iframe → 有 work 就 runFiller
  scheduleAutoScan(2500, 'initial boot');
  watchUrl(
    (url, prev) => {
      console.info(`[netclass-sidekick] URL change: ${prev} → ${url}`);
      scheduleAutoScan(2500, 'url change');
    },
    { intervalMs: 2000 },
  );
}

/**
 * 延迟 delayMs 后扫描同源 iframe 树：
 *   - work iframe → runFiller（需要 automationEnabled）
 *   - video/audio → 由 adapter 的 padder 已在处理，这里不再重复
 */
let _autoScanTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoScan(delayMs: number, reason: string): void {
  if (_autoScanTimer) clearTimeout(_autoScanTimer);
  _autoScanTimer = setTimeout(() => {
    _autoScanTimer = null;
    console.info(`[netclass-sidekick] auto-scan (${reason}) kind=${currentPageKind()}`);
    void scanAndFill(document, { force: false });
  }, delayMs);
}

async function scanAndFill(
  rootDoc: Document,
  opts: { force: boolean },
): Promise<void> {
  // 手动"扫描"按钮即使 automation off 也要走；自动路径尊重开关
  if (!opts.force && !runtimeState.automationEnabled) {
    console.info('[netclass-sidekick] auto-scan skipped — automation OFF');
    return;
  }

  await dispatchIframes(rootDoc, {
    onWork: async (meta) => {
      const doc = (meta.iframe as HTMLIFrameElement).contentDocument;
      if (!doc) return;
      console.info(`[netclass-sidekick] runFiller on work iframe: ${meta.src.slice(0, 80)}`);
      await runFiller(doc);
    },
  });
}

// document-start 时 DOM 还没准备，等 DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
