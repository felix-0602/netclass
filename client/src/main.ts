// Netclass Sidekick — 客户端入口
// @match 范围内任何页面加载完成后触发

import { detectPlatform } from './lib/platform';
import { bootChaoxing } from './adapters/chaoxing';
import { bootUnipus } from './adapters/unipus';

function boot() {
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
}

// document-start 时 DOM 还没准备，等 DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
