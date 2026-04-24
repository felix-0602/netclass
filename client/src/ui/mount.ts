// 把 Panel.vue 挂到当前页面。
//
// 关键约束：
//   1. **只在顶层 frame 挂**。超星页面是 1-4 层 iframe，userscript 在每个 frame
//      都跑一遍 boot()，若不防护就会出现 N 个浮窗。视觉只需要 1 个；
//      adapter 内部的 video padder 还是会递归进 iframe 工作，互不影响。
//   2. document.getElementById 仅防同 frame 重复，不防跨 frame —— 顶层 frame
//      判断必须用 window.self === window.top。
//   3. rehydrateConfig 在 Vue 挂载前调用，让已激活用户刷新页面后免输卡密。
//   4. **Shadow DOM 隔离**：宿主页面（chaoxing/unipus）有大量 `* { ... !important }`
//      规则，Vue scoped style 防御不了。挂进 open shadow root，把 GM_addStyle 注入到
//      document.head 里属于我们的 `<style>` 平移进 shadow root。

import { createApp, h } from 'vue';
import Panel from './Panel.vue';
import { rehydrateConfig } from '@/answer/session';

const HOST_ID = 'netclass-sidekick-host';

// CSS 选择器特征：用来认出哪些 <style> 是 Panel.vue 生成的（含 scoped data-v-XXX）
// 任一关键字命中即认为该 <style> 是我们的。
const PANEL_STYLE_SIGNATURES = ['.ns-pill', '.ns-panel', '.ns-modal'];

interface MountOptions {
  platform: string | null;
}

export function mountPanel(opts: MountOptions): void {
  // 顶层 frame 守卫
  let isTop = false;
  try {
    isTop = window.self === window.top;
  } catch {
    isTop = false;
  }
  if (!isTop) {
    console.info('[netclass-sidekick] skip mount — not top frame');
    return;
  }
  if (document.getElementById(HOST_ID)) {
    console.info('[netclass-sidekick] skip mount — already mounted');
    return;
  }
  if (!document.body) {
    console.warn('[netclass-sidekick] no document.body at mount time');
    return;
  }

  rehydrateConfig();

  // 1. host div 在 body
  const host = document.createElement('div');
  host.id = HOST_ID;
  // 给 host 一个 reset 样式，避免宿主 body 里的 `* { ... }` 影响 host 自身
  host.style.cssText = 'all: initial; position: static;';
  document.body.appendChild(host);

  // 2. open shadow root（debug 友好；closed root 也行，但生产排错难）
  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: 'open' });
  } catch (e) {
    console.warn('[netclass-sidekick] attachShadow failed, falling back to host', e);
    mountVueInto(host, opts);
    return;
  }

  // 3. 把 document.head 里属于 Panel 的 <style> 移进 shadow root
  movePanelStylesIntoShadow(shadow);

  // 4. shadow 内建一个挂载点
  const mountTarget = document.createElement('div');
  mountTarget.className = 'ns-shadow-root';
  shadow.appendChild(mountTarget);

  // 5. 挂 Vue
  mountVueInto(mountTarget, opts);

  console.info(
    `[netclass-sidekick] panel mounted on ${opts.platform ?? 'unknown'} @ ${location.host} (shadow DOM)`,
  );
}

function mountVueInto(target: Element, opts: MountOptions): void {
  const app = createApp({
    render: () =>
      h(Panel, {
        platform: opts.platform,
        'onOpen-settings': () => {
          console.info('[netclass-sidekick] open-settings (Phase 0 placeholder)');
        },
      }),
  });
  app.mount(target);
}

/**
 * 扫 document.head 找内容含 Panel 类名特征的 <style>，平移进 shadow root。
 *
 * vite-plugin-monkey 在 userscript 顶部把所有 SFC 的 <style scoped> 输出
 * 编译成单个 GM_addStyle(css) 调用 → Tampermonkey 把它注成 <style> 进 head。
 * 平移之后 head 里就没我们的 CSS 了，但 shadow root 里有。
 */
function movePanelStylesIntoShadow(shadow: ShadowRoot): number {
  const styles = Array.from(document.head.querySelectorAll('style'));
  let moved = 0;
  for (const style of styles) {
    const text = style.textContent ?? '';
    if (!text) continue;
    const isOurs = PANEL_STYLE_SIGNATURES.some((sig) => text.includes(sig));
    if (!isOurs) continue;
    // 直接 move 节点（不是 clone），避免重复样式残留在 head 影响宿主
    shadow.appendChild(style);
    moved++;
  }
  if (moved === 0) {
    console.warn(
      '[netclass-sidekick] no Panel styles found in head — shadow root will render unstyled. Check PANEL_STYLE_SIGNATURES.',
    );
  }
  return moved;
}
