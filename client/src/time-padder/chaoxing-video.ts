// 超星视频自动播放 + 心跳上报（刷时长功能核心）
// Phase 0 Week 1 实装；骨架迁移自原 app.js 视频控制区块
//
// 关键行为：
//  - muted 播放（避免打扰用户）
//  - playbackRate 可配置（默认 1.5x，上限 2x，加 ±0.1 jitter 防检测）
//  - visibilitychange 切到后台时不暂停计时（平台侧统计若挂起会重置）
//  - 心跳 POST：平台有自己的进度上报 API（需要抓原 app.js 现有 log endpoint）

interface VideoPadderOptions {
  playbackRate?: number;
  mute?: boolean;
}

export function startChaoxingVideoPadder(opts: VideoPadderOptions = {}) {
  const { playbackRate = 1.5, mute = true } = opts;

  const videos = document.querySelectorAll('video');
  if (videos.length === 0) {
    // 视频 iframe 可能跟主 document 分开，后续 adapter 会传入 iframe doc
    return;
  }

  videos.forEach((v) => attachPadder(v, playbackRate, mute));
}

function attachPadder(v: HTMLVideoElement, rate: number, mute: boolean) {
  if (mute) v.muted = true;
  // 用 random jitter 防"整齐 1.5x" 特征
  const jittered = rate + (Math.random() - 0.5) * 0.2;
  v.playbackRate = Math.min(2, Math.max(0.5, jittered));

  // 自动播放
  const tryPlay = () => v.play().catch(() => {
    // 若被 autoplay policy 拦，等用户首次点击再试
    const once = () => {
      v.play();
      document.removeEventListener('click', once);
    };
    document.addEventListener('click', once, { once: true });
  });
  tryPlay();

  // document-hidden 时浏览器会 throttle setInterval，用 video.addEventListener('timeupdate')
  // 作为心跳源（即便 tab 隐藏，超星 video 仍在播，timeupdate 仍会触发）
  let lastReport = 0;
  v.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastReport < 5_000) return;
    lastReport = now;
    reportHeartbeat(v);
  });

  // 视频结束 → TODO: 自动跳下一节任务点（chaoxing-task.ts，Phase 0 Week 1）
  v.addEventListener('ended', () => {
    console.info('[netclass-sidekick/chaoxing] video ended, jump next task TODO');
  });
}

function reportHeartbeat(_v: HTMLVideoElement) {
  // Phase 0 Week 1 TODO：
  // 参考原 app.js 里的 /log 上报接口（需要传 clazzId, courseId, otherInfo, duration 等）
  // 超星会根据这个心跳判定观看进度
  // 这里先占位：
  // GM_xmlhttpRequest({ url: ..., method: 'POST', data: JSON.stringify({...}) });
}
