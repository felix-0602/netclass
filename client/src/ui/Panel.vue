<template>
  <!-- 折叠态：左下角小药丸 -->
  <div
    v-if="collapsed"
    class="ns-pill"
    :style="positionStyle"
    @mousedown="onDragStart"
    @click="collapsed = false"
    :title="pillTitle"
  >
    <span class="ns-pill__dot" :class="`ns-dot--${dotKind}`" />
    <span class="ns-pill__label">{{ pillLabel }}</span>
  </div>

  <!-- 展开态：完整面板 -->
  <div v-else class="ns-panel" :style="positionStyle" @mousedown.stop>
    <div class="ns-panel__header" @mousedown="onDragStart">
      <div class="ns-header__main">
        <span class="ns-panel__title">🥇 Netclass Sidekick</span>
        <span class="ns-status-chip" :class="`ns-status-chip--${runtimeState.status}`">
          {{ statusText }}
        </span>
      </div>
      <div class="ns-header__meta">
        <span v-if="lastSuccessText" class="ns-last-success" :title="lastSuccessTooltip">
          {{ lastSuccessText }}
        </span>
        <span class="ns-panel__minus" @click="collapsed = true" title="收起">─</span>
      </div>
    </div>

    <!-- Section triage banner -->
    <div
      v-if="triageBanner"
      class="ns-triage"
      :class="`ns-triage--${runtimeState.sectionTriage.state}`"
    >
      <strong class="ns-triage__title">{{ triageBanner.title }}</strong>
      <p class="ns-triage__body">{{ triageBanner.body }}</p>
      <div class="ns-triage__counts">
        <span class="ns-chip ns-chip--ok">已命中 {{ runtimeState.sectionTriage.readyLocal }}</span>
        <span v-if="runtimeState.sectionTriage.pending > 0" class="ns-chip ns-chip--pending">
          收录中 {{ runtimeState.sectionTriage.pending }}
        </span>
        <span v-if="runtimeState.sectionTriage.errors > 0" class="ns-chip ns-chip--err">
          异常 {{ runtimeState.sectionTriage.errors }}
        </span>
      </div>
    </div>

    <!-- 当前动作 -->
    <div class="ns-current">
      <span class="ns-current__label">当前</span>
      <strong class="ns-current__msg" :title="runtimeState.message">
        {{ runtimeState.message || '—' }}
      </strong>
    </div>

    <!-- 控制台日志区 -->
    <div class="ns-console-wrap">
      <div class="ns-console-toolbar">
        <span class="ns-console-title">运行日志（{{ runtimeState.logs.length }}/50）</span>
        <button
          class="ns-console-toggle"
          :class="{ 'ns-console-toggle--paused': !autoScroll }"
          @click="onToggleAutoScroll"
          :title="autoScroll ? '当前自动滚到底；点击暂停' : '当前已暂停滚动；点击跟随最新'"
        >
          {{ autoScroll ? '跟随最新' : '已暂停' }}
        </button>
      </div>
      <div ref="consoleEl" class="ns-console" @wheel="onConsoleWheel">
        <div v-if="runtimeState.logs.length === 0" class="ns-console__empty">
          暂无日志，等待扫描…
        </div>
        <div
          v-for="event in runtimeState.logs"
          :key="event.id"
          class="ns-log"
          :class="`ns-log--${event.level}`"
        >
          <time class="ns-log__ts">{{ formatClock(event.ts) }}</time>
          <span class="ns-log__text">{{ event.text }}</span>
        </div>
      </div>
    </div>

    <!-- 详细信息（默认折叠） -->
    <div class="ns-details">
      <div class="ns-details__head" @click="detailsOpen = !detailsOpen">
        <span>{{ detailsOpen ? '▾' : '▸' }} 账号 / 平台 / 缓存</span>
      </div>
      <div v-if="detailsOpen" class="ns-details__body">
        <div class="ns-row">
          <span>平台</span>
          <strong>{{ platform || '—' }}</strong>
        </div>
        <div class="ns-row">
          <span>题库缓存</span>
          <strong>{{ cacheStats.count }} 题 · {{ Math.round(cacheStats.bytes / 1024) }} KB</strong>
        </div>
        <div class="ns-row">
          <span>账号</span>
          <strong v-if="session" class="ns-account">
            {{ session.cardkey_preview }}
            <span class="ns-plan">{{ session.plan }}</span>
          </strong>
          <strong v-else class="ns-account ns-account--off">未激活</strong>
        </div>
        <div class="ns-row">
          <span>自动托管</span>
          <strong>
            <button
              class="ns-toggle"
              :class="{ 'ns-toggle--on': runtimeState.automationEnabled }"
              @click="onToggleAutomation"
            >
              {{ runtimeState.automationEnabled ? 'ON' : 'OFF' }}
            </button>
          </strong>
        </div>
        <div class="ns-row">
          <span>处理主观题</span>
          <strong>
            <button
              class="ns-toggle"
              :class="{ 'ns-toggle--on': essayEnabled }"
              @click="essayEnabled = !essayEnabled"
            >
              {{ essayEnabled ? 'ON' : 'OFF' }}
            </button>
          </strong>
        </div>
        <div class="ns-row">
          <span>提交前询问</span>
          <strong>
            <button
              class="ns-toggle"
              :class="{ 'ns-toggle--on': askBeforeSubmit }"
              @click="askBeforeSubmit = !askBeforeSubmit"
            >
              {{ askBeforeSubmit ? 'ON' : 'OFF' }}
            </button>
          </strong>
        </div>
      </div>
    </div>

    <!-- 操作区 -->
    <div class="ns-actions">
      <button @click="onManualScan" :disabled="!session" :title="!session ? '请先激活卡密' : '立即扫描当前页面题目'">
        扫描
      </button>
      <button @click="$emit('open-settings')">设置</button>
    </div>
    <div class="ns-actions">
      <!-- 空闲/已停止 → 开始 -->
      <button
        v-if="!courseActive && !coursePaused"
        class="ns-btn--primary"
        :disabled="!session"
        @click="onStartCourse"
        :title="!session ? '请先激活卡密' : '从当前章节开始，自动走完本门课所有任务点'"
      >
        🚀 全课代戉
      </button>
      <!-- 运行中 → 暂停 -->
      <button
        v-else-if="courseActive && !coursePaused"
        class="ns-btn--warn"
        @click="onPauseCourse"
        :title="'暂停自动托管，保留进度'"
      >
        ⏸ 暂停（已过 {{ courseChaptersHandled }} 节）
      </button>
      <!-- 已暂停 → 继续 / 停止 -->
      <template v-else-if="coursePaused">
        <button class="ns-btn--primary" @click="onStartCourse" title="从当前章节继续">
          ▶ 继续（已过 {{ courseChaptersHandled }} 节）
        </button>
        <button class="ns-btn--danger" @click="onStopCourse" title="完全停止并重置进度">
          ⏹ 停止
        </button>
      </template>
    </div>
    <div class="ns-actions">
      <button v-if="!session" class="ns-btn--primary" @click="openActivate">激活卡密</button>
      <template v-else>
        <button @click="openActivate">换卡密</button>
        <button class="ns-btn--danger" @click="onLogout">退出</button>
      </template>
    </div>

    <!-- 卡密激活 Dialog（保留原样） -->
    <div v-if="dialogOpen" class="ns-modal" @click.self="closeDialog">
      <div class="ns-modal__card" @mousedown.stop>
        <div class="ns-modal__header">
          <span>激活卡密</span>
          <span class="ns-modal__close" @click="closeDialog">×</span>
        </div>
        <div class="ns-modal__body">
          <label class="ns-field">
            <span>服务端地址</span>
            <input
              v-model="form.serverBase"
              type="text"
              spellcheck="false"
              placeholder="http://182.254.180.181:8080"
              :disabled="submitting"
            />
          </label>
          <label class="ns-field">
            <span>卡密</span>
            <input
              v-model="form.cardkey"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="NSK-XXXXXXXX-XXXXXXXX"
              :disabled="submitting"
              @keyup.enter="onSubmit"
            />
          </label>
          <p v-if="errorMsg" class="ns-error">{{ errorMsg }}</p>
          <p v-else class="ns-hint">
            首次激活会绑定本设备（最多 3 台）。卡密在本地不会被明文存储。
          </p>
        </div>
        <div class="ns-modal__footer">
          <button :disabled="submitting" @click="closeDialog">取消</button>
          <button
            class="ns-btn--primary"
            :disabled="submitting || !form.cardkey.trim()"
            @click="onSubmit"
          >
            {{ submitting ? '激活中…' : '激活' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { cacheStats as getCacheStats } from '@/answer/cache';
import { userSettings } from '@/answer/settings';
import {
  activate,
  ActivateException,
  clearSession,
  loadServerBase,
  loadSession,
  type Session,
} from '@/answer/session';
import {
  runtimeState,
  requestManualScan,
  requestPauseCourse,
  requestStartCourse,
  requestStopCourse,
  setAutomationEnabled,
} from '@/runtime/state';
import { courseProgress } from '@/runtime/course-runner';

defineProps<{
  platform: string | null;
}>();

const emit = defineEmits<{
  'open-settings': [];
  'session-change': [Session | null];
}>();

const collapsed = ref(true);
const detailsOpen = ref(false);

const pos = ref({ x: 16, y: Math.max(80, window.innerHeight - 56) });
const positionStyle = computed(() => ({
  left: pos.value.x + 'px',
  top: pos.value.y + 'px',
}));

const cacheStats = computed(() => getCacheStats());

const STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  working: '处理中',
  error: '出错',
};
const statusText = computed(() => STATUS_TEXT[runtimeState.status] ?? '空闲');

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  return Math.floor(diff / 86_400_000) + ' 天前';
}

const lastSuccessText = computed(() =>
  runtimeState.lastSuccessAt ? '✓ 最近成功 ' + formatRelative(runtimeState.lastSuccessAt) : '',
);
const lastSuccessTooltip = computed(() =>
  runtimeState.lastSuccessAt ? new Date(runtimeState.lastSuccessAt).toLocaleString() : '',
);

// session
const session = ref<Session | null>(loadSession());

// pill
const dotKind = computed<'on' | 'off' | 'err' | 'work'>(() => {
  if (runtimeState.status === 'error') return 'err';
  if (runtimeState.status === 'working') return 'work';
  return session.value ? 'on' : 'off';
});

const pillLabel = computed(() => {
  if (runtimeState.status === 'error') return '出错';
  if (courseRunning.value) return `🚀 ${courseChaptersHandled.value} 节`;

  // 优先看 sectionTriage：用户最想第一眼看到的就是"本节什么状态"
  const t = runtimeState.sectionTriage;
  if (t.state === 'all-ready') return `可答 ${t.readyLocal}/${t.total}`;
  if (t.state === 'partial-pending') return `部分收录中 ${t.pending}`;
  if (t.state === 'all-pending') return '整节收录中';
  if (t.state === 'mixed' && runtimeState.status === 'working') {
    return `${runtimeState.answered}/${runtimeState.detected}`;
  }

  if (runtimeState.status === 'working') {
    if (runtimeState.detected > 0) return `${runtimeState.answered}/${runtimeState.detected}`;
    return runtimeState.phase || '处理中';
  }
  if (!session.value) return '未激活';
  return runtimeState.message
    ? truncate(runtimeState.message, 12)
    : 'ready';
});

const pillTitle = computed(
  () =>
    `Netclass Sidekick · ${session.value ? session.value.cardkey_preview : '未激活'} · ${runtimeState.message || ''}`,
);

interface TriageCopy {
  title: string;
  body: string;
}
const triageBanner = computed<TriageCopy | null>(() => {
  const t = runtimeState.sectionTriage;
  if (t.state === 'unknown' && t.total === 0) return null;
  switch (t.state) {
    case 'all-ready':
      return {
        title: '本节可立即完成',
        body: `已命中全部 ${t.total} 题答案（本地 ${t.readyLocal} / 服务端命中 ${t.total - t.readyLocal}），正在或已完成填写。`,
      };
    case 'mixed':
      return {
        title: '部分本地命中，剩余正在联网查询',
        body: `本地缓存已命中 ${t.readyLocal}/${t.total}，剩余 ${t.needsServer} 题会问服务端；命中或新收录将在下方日志中实时显示。`,
      };
    case 'partial-pending':
      return {
        title: '部分题目正在收录',
        body: `已命中 ${t.readyLocal + (t.total - t.readyLocal - t.pending - t.errors)}/${t.total}，${t.pending} 题已提交服务端处理，通常几分钟后重进本节会自动答完。`,
      };
    case 'all-pending':
      return {
        title: '本节题目已全部提交收录',
        body: '本次没有可直接填写的答案。服务端正在 OCR + 解题，稍后重新进入本节会自动答题。',
      };
    case 'unknown':
    default:
      return {
        title: '正在联网查询答案',
        body: `共 ${t.total} 题，未命中本地缓存；命中或新收录将在下方日志中实时显示。`,
      };
  }
});

// course runner
const courseActive = ref(courseProgress.active);
const coursePaused = ref(courseProgress.paused);
const courseRunning = ref(courseProgress.active && !courseProgress.paused);
const courseChaptersHandled = ref(courseProgress.chaptersHandled);
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    courseActive.value = courseProgress.active;
    coursePaused.value = courseProgress.paused;
    courseRunning.value = courseProgress.active && !courseProgress.paused;
    courseChaptersHandled.value = courseProgress.chaptersHandled;
  }, 1000);
}

// 控制台自动滚动 — 默认开启，wheel 上滚自动暂停（codex 第 7 条风险缓解）
const autoScroll = ref(true);
const consoleEl = ref<HTMLElement | null>(null);

function onToggleAutoScroll() {
  autoScroll.value = !autoScroll.value;
  if (autoScroll.value) scrollConsoleToBottom();
}
function onConsoleWheel(e: WheelEvent) {
  // 用户向上滚 → 暂停 autoScroll；滚到底部附近重新启用
  const el = consoleEl.value;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 24;
  if (e.deltaY < 0 && autoScroll.value) autoScroll.value = false;
  else if (nearBottom && !autoScroll.value) autoScroll.value = true;
}
function scrollConsoleToBottom() {
  const el = consoleEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}
watch(
  () => runtimeState.logs.length,
  () => {
    if (!autoScroll.value) return;
    nextTick(scrollConsoleToBottom);
  },
);

// dialog
const dialogOpen = ref(false);
const submitting = ref(false);
const errorMsg = ref('');
const form = reactive({
  serverBase: loadServerBase(),
  cardkey: '',
});

function openActivate() {
  form.serverBase = loadServerBase();
  form.cardkey = '';
  errorMsg.value = '';
  dialogOpen.value = true;
}
function closeDialog() {
  if (submitting.value) return;
  dialogOpen.value = false;
}

async function onSubmit() {
  if (submitting.value) return;
  errorMsg.value = '';
  submitting.value = true;
  try {
    const next = await activate(form.cardkey, form.serverBase);
    session.value = next;
    emit('session-change', next);
    dialogOpen.value = false;
  } catch (e: unknown) {
    if (e instanceof ActivateException) errorMsg.value = e.detail.message;
    else if (e instanceof Error) errorMsg.value = e.message;
    else errorMsg.value = '未知错误';
  } finally {
    submitting.value = false;
  }
}

function onLogout() {
  clearSession();
  session.value = null;
  emit('session-change', null);
}

function onManualScan() {
  requestManualScan();
}

function onToggleAutomation() {
  setAutomationEnabled(!runtimeState.automationEnabled);
}

// 用户偏好设置（响应式绑定 localStorage）
const essayEnabled = ref(userSettings.essayEnabled);
const askBeforeSubmit = ref(userSettings.askBeforeSubmit);
watch(essayEnabled, (v) => { userSettings.essayEnabled = v; });
watch(askBeforeSubmit, (v) => { userSettings.askBeforeSubmit = v; });

function onStartCourse() {
  if (!runtimeState.automationEnabled) setAutomationEnabled(true);
  requestStartCourse();
  courseActive.value = true;
  coursePaused.value = false;
  courseRunning.value = true;
  if (!courseProgress.paused) courseChaptersHandled.value = 0;
}

function onPauseCourse() {
  requestPauseCourse();
  coursePaused.value = true;
  courseRunning.value = false;
}

function onStopCourse() {
  requestStopCourse();
  courseActive.value = false;
  coursePaused.value = false;
  courseRunning.value = false;
  courseChaptersHandled.value = 0;
}

// drag
let dragStart: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;

function onDragStart(e: MouseEvent) {
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    px: pos.value.x,
    py: pos.value.y,
    moved: false,
  };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd, { once: true });
}
function onDragMove(e: MouseEvent) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragStart.moved = true;
  pos.value = { x: dragStart.px + dx, y: dragStart.py + dy };
}
function onDragEnd(e: MouseEvent) {
  if (dragStart?.moved) {
    e.stopPropagation();
    const block = (ev: MouseEvent) => {
      ev.stopPropagation();
      window.removeEventListener('click', block, true);
    };
    window.addEventListener('click', block, true);
  }
  dragStart = null;
  document.removeEventListener('mousemove', onDragMove);
}
</script>

<style scoped>
/* ---- 折叠态 ---- */
.ns-pill {
  position: fixed;
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(31, 113, 224, 0.95);
  color: #fff;
  border-radius: 999px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transition: background 0.15s;
}
.ns-pill:hover { background: rgba(24, 96, 194, 1); }
.ns-pill__dot {
  width: 10px; height: 10px; border-radius: 50%; background: #67c23a;
}
.ns-dot--on { background: #67c23a; }
.ns-dot--off { background: #909399; }
.ns-dot--work { background: #f5d04e; animation: ns-pulse 1.4s infinite; }
.ns-dot--err { background: #f56c6c; animation: ns-pulse 1.2s infinite; }
@keyframes ns-pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
}
.ns-pill__label { line-height: 1; }

/* ---- 展开态：宽度 320，高度上限 540 ---- */
.ns-panel {
  position: fixed;
  z-index: 2147483646;
  width: 320px;
  max-height: 540px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  font-family: system-ui, sans-serif;
  font-size: 13px;
  user-select: none;
  color: #303133;
  overflow: hidden;
}

/* Header */
.ns-panel__header {
  background: #1f71e0;
  color: #fff;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
  flex-shrink: 0;
}
.ns-header__main { display: flex; align-items: center; gap: 8px; }
.ns-panel__title { font-size: 13px; font-weight: 600; }
.ns-status-chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.2);
}
.ns-status-chip--idle { background: rgba(103, 194, 58, 0.85); }
.ns-status-chip--working { background: rgba(245, 208, 78, 0.95); color: #5a4500; }
.ns-status-chip--error { background: rgba(245, 108, 108, 0.95); }
.ns-header__meta { display: flex; align-items: center; gap: 10px; }
.ns-last-success {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ns-panel__minus { cursor: pointer; padding: 0 4px; font-size: 14px; }

/* Triage banner */
.ns-triage {
  margin: 10px 12px 0;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 4px solid #909399;
  background: #f4f4f5;
  flex-shrink: 0;
}
.ns-triage--all-ready { border-left-color: #67c23a; background: #f0f9eb; }
.ns-triage--mixed { border-left-color: #1f71e0; background: #ecf5ff; }
.ns-triage--partial-pending { border-left-color: #e6a23c; background: #fdf6ec; }
.ns-triage--all-pending { border-left-color: #1f71e0; background: #ecf5ff; }
.ns-triage--unknown { border-left-color: #909399; background: #f4f4f5; }
.ns-triage__title { font-size: 13px; font-weight: 600; display: block; margin-bottom: 4px; }
.ns-triage__body { font-size: 12px; color: #606266; margin: 0 0 6px 0; line-height: 1.5; }
.ns-triage__counts { display: flex; gap: 6px; flex-wrap: wrap; }
.ns-chip {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}
.ns-chip--ok { background: #f0f9eb; color: #67c23a; }
.ns-chip--pending { background: #fdf6ec; color: #e6a23c; }
.ns-chip--err { background: #fef0f0; color: #f56c6c; }

/* 当前动作 */
.ns-current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.ns-current__label { color: #909399; flex-shrink: 0; }
.ns-current__msg {
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 控制台 */
.ns-console-wrap {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 120px;
  max-height: 220px;
  border-bottom: 1px solid #ebeef5;
}
.ns-console-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  background: #fafafa;
  font-size: 11px;
  color: #909399;
  flex-shrink: 0;
}
.ns-console-toggle {
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid #dcdfe6;
  background: #fff;
  font-size: 10px;
  cursor: pointer;
  color: #606266;
}
.ns-console-toggle--paused { background: #fdf6ec; border-color: #e6a23c; color: #e6a23c; }
.ns-console {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 12px 8px;
  background: #1e1e1e;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: #d4d4d4;
}
.ns-console__empty { color: #6a737d; padding: 6px 0; font-style: italic; }
.ns-log {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  line-height: 1.5;
}
.ns-log__ts { color: #6a737d; flex-shrink: 0; }
.ns-log__text { word-break: break-word; }
.ns-log--info .ns-log__text { color: #d4d4d4; }
.ns-log--ok .ns-log__text { color: #7fc97f; }
.ns-log--warn .ns-log__text { color: #f5d04e; }
.ns-log--err .ns-log__text { color: #f56c6c; }

/* 详细信息 */
.ns-details {
  flex-shrink: 0;
  border-bottom: 1px solid #ebeef5;
}
.ns-details__head {
  padding: 6px 12px;
  font-size: 11px;
  color: #909399;
  cursor: pointer;
  user-select: none;
}
.ns-details__head:hover { background: #f4f4f5; }
.ns-details__body { padding: 4px 12px 8px; }
.ns-row {
  display: flex;
  justify-content: space-between;
  margin: 4px 0;
  align-items: center;
  font-size: 12px;
  gap: 8px;
}
.ns-row > span:first-child { color: #606266; flex-shrink: 0; }
.ns-row > strong { text-align: right; word-break: break-all; }
.ns-toggle {
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid #dcdfe6;
  background: #f4f4f5;
  color: #909399;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}
.ns-toggle--on { background: #67c23a; border-color: #67c23a; color: #fff; }
.ns-account { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.ns-account--off { color: #909399; font-weight: normal; }
.ns-plan {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  background: #ecf5ff;
  color: #1f71e0;
  border-radius: 3px;
  font-size: 11px;
  font-family: system-ui, sans-serif;
}

/* 操作 */
.ns-actions {
  display: flex;
  gap: 8px;
  padding: 6px 12px;
  flex-shrink: 0;
}
.ns-actions:last-child { padding-bottom: 10px; }
.ns-actions button {
  flex: 1;
  padding: 6px;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #303133;
}
.ns-actions button:hover:not(:disabled) { background: #e9e9eb; }
.ns-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.ns-btn--primary {
  background: #1f71e0 !important;
  color: #fff !important;
  border-color: #1f71e0 !important;
}
.ns-btn--primary:hover:not(:disabled) { background: #1860c2 !important; }
.ns-btn--warn {
  background: #e6a23c !important;
  color: #fff !important;
  border-color: #e6a23c !important;
}
.ns-btn--warn:hover:not(:disabled) { background: #cf9236 !important; }
.ns-btn--danger { color: #e04e4e !important; }

/* Modal */
.ns-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ns-modal__card {
  width: 360px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  font-family: system-ui, sans-serif;
  color: #303133;
  font-size: 13px;
}
.ns-modal__header {
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}
.ns-modal__close { cursor: pointer; font-size: 18px; line-height: 1; color: #909399; }
.ns-modal__close:hover { color: #303133; }
.ns-modal__body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.ns-modal__footer {
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ns-modal__footer button {
  padding: 6px 16px;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #303133;
}
.ns-modal__footer button:hover:not(:disabled) { background: #e9e9eb; }
.ns-modal__footer button:disabled { opacity: 0.5; cursor: not-allowed; }
.ns-field { display: flex; flex-direction: column; gap: 4px; }
.ns-field span { font-size: 12px; color: #606266; }
.ns-field input {
  padding: 6px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
  color: #303133;
  background: #fff;
}
.ns-field input:focus { border-color: #1f71e0; }
.ns-field input:disabled { background: #f4f4f5; cursor: not-allowed; }
.ns-error { margin: 0; color: #e04e4e; font-size: 12px; }
.ns-hint { margin: 0; color: #909399; font-size: 12px; }
</style>
