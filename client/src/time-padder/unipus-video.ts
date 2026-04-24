// U 校园视频/音频自动播放 + 活跃度模拟
// Phase 1 Week 2 实装
//
// U 校园跟超星的差异（docs/recon/reconnaissance-2026-04-24.md §U校园）：
//  - 是 SPA（React），无 iframe 嵌套
//  - 有活跃度检测：鼠标/键盘长时间无操作 → 视频暂停
//  - 进度上报通过 XHR/fetch，不是 form POST
//
// 关键对策：
//  1. 定时模拟 mousemove（每 3min，jitter ±30s）
//  2. 抓 audio/video 原 src，hook play 方法不让用户手动暂停变成"真暂停"
//  3. 成绩明细页抓"必修学习时长"数值做前后对比（验证指标）

export function startUnipusVideoPadder() {
  // Phase 1 Week 2 TODO
  console.info('[netclass-sidekick/unipus] video padder placeholder — Phase 1 Week 2');
}

/** 活跃度模拟器：每 3min ± 30s 派发一次 mousemove */
export function startActivitySimulator() {
  const fire = () => {
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 100 + Math.random() * 600,
        clientY: 100 + Math.random() * 400,
        bubbles: true,
      }),
    );
    const next = 3 * 60_000 + (Math.random() - 0.5) * 60_000;
    setTimeout(fire, next);
  };
  setTimeout(fire, 3 * 60_000);
}
