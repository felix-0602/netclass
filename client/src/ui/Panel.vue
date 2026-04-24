<template>
  <!-- 折叠态：左下角小药丸，状态点 + 简短消息 -->
  <div
    v-if="collapsed"
    class="ns-pill"
    :style="positionStyle"
    @mousedown="onDragStart"
    @click="collapsed = false"
    :title="`Netclass Sidekick · ${session ? session.cardkey_preview : '未激活'} · ${runtimeState.message || ''}`"
  >
    <span class="ns-pill__dot" :class="`ns-dot--${dotKind}`" />
    <span class="ns-pill__label">{{ pillLabel }}</span>
  </div>

  <!-- 展开态：完整面板 -->
  <div v-else class="ns-panel" :style="positionStyle" @mousedown.stop>
    <div class="ns-panel__header" @mousedown="onDragStart">
      <span class="ns-panel__title">🥇 Netclass Sidekick</span>
      <span class="ns-panel__minus" @click="collapsed = true" title="收起">─</span>
    </div>
    <div class="ns-panel__body">
      <div class="ns-row">
        <span>状态</span>
        <strong :class="`ns-status ns-status--${runtimeState.status}`">{{ statusText }}</strong>
      </div>
      <div class="ns-row" v-if="runtimeState.phase && runtimeState.phase !== 'idle'">
        <span>阶段</span>
        <strong class="ns-phase">{{ runtimeState.phase }}</strong>
      </div>
      <div class="ns-row" v-if="runtimeState.message">
        <span>信息</span>
        <strong class="ns-message" :title="runtimeState.message">{{ truncate(runtimeState.message, 22) }}</strong>
      </div>
      <div class="ns-row" v-if="hasProgress">
        <span>答题进度</span>
        <strong>
          {{ runtimeState.answered }} / {{ runtimeState.detected }}
          <span v-if="runtimeState.pending > 0" class="ns-badge ns-badge--pending">{{ runtimeState.pending }} 待</span>
          <span v-if="runtimeState.errors > 0" class="ns-badge ns-badge--err">{{ runtimeState.errors }} 错</span>
        </strong>
      </div>
      <div class="ns-row">
        <span>自动托管</span>
        <strong>
          <button class="ns-toggle" :class="{ 'ns-toggle--on': runtimeState.automationEnabled }" @click="onToggleAutomation">
            {{ runtimeState.automationEnabled ? 'ON' : 'OFF' }}
          </button>
        </strong>
      </div>
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

      <div class="ns-actions">
        <button @click="onManualScan" :disabled="!session" :title="!session ? '请先激活卡密' : '立即扫描当前页面题目'">
          扫描
        </button>
        <button @click="$emit('open-settings')">设置</button>
      </div>
      <div class="ns-actions">
        <button v-if="!session" class="ns-btn--primary" @click="openActivate">激活卡密</button>
        <template v-else>
          <button @click="openActivate">换卡密</button>
          <button class="ns-btn--danger" @click="onLogout">退出</button>
        </template>
      </div>
    </div>

    <!-- 卡密激活 Dialog -->
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
import { computed, reactive, ref } from 'vue';
import { cacheStats as getCacheStats } from '@/answer/cache';
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
  setAutomationEnabled,
} from '@/runtime/state';

defineProps<{
  platform: string | null;
}>();

const emit = defineEmits<{
  'open-settings': [];
  'session-change': [Session | null];
}>();

// UX 默认折叠 —— 跟原 app.js 风格一致：打开课程页就静默工作，不打扰
const collapsed = ref(true);

// 默认贴左下角 —— 超星右侧"目录/讨论/笔记"侧栏会盖住右下角
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

const hasProgress = computed(
  () => runtimeState.detected > 0 || runtimeState.answered > 0 || runtimeState.errors > 0,
);

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// session
const session = ref<Session | null>(loadSession());

// pill 显示
const dotKind = computed<'on' | 'off' | 'err' | 'work'>(() => {
  if (runtimeState.status === 'error') return 'err';
  if (runtimeState.status === 'working') return 'work';
  return session.value ? 'on' : 'off';
});

const pillLabel = computed(() => {
  if (runtimeState.status === 'error') return '出错';
  if (runtimeState.status === 'working') {
    // 工作中显进度（X/Y）或阶段或消息
    if (runtimeState.detected > 0) {
      return `${runtimeState.answered}/${runtimeState.detected}`;
    }
    return runtimeState.phase || '处理中';
  }
  if (!session.value) return '未激活';
  return runtimeState.message
    ? truncate(runtimeState.message, 12)
    : (typeof window !== 'undefined' && window.location?.hostname?.split('.').slice(-2).join('.')) || 'ready';
});

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
    if (e instanceof ActivateException) {
      errorMsg.value = e.detail.message;
    } else if (e instanceof Error) {
      errorMsg.value = e.message;
    } else {
      errorMsg.value = '未知错误';
    }
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

// drag —— pill 和 panel 共用
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
/* ---- 折叠态：左下角小药丸 ---- */
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
.ns-pill:hover {
  background: rgba(24, 96, 194, 1);
}
.ns-pill__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #67c23a;
}
.ns-dot--on {
  background: #67c23a;
}
.ns-dot--off {
  background: #909399;
}
.ns-dot--work {
  background: #f5d04e;
  animation: ns-pulse 1.4s infinite;
}
.ns-dot--err {
  background: #f56c6c;
  animation: ns-pulse 1.2s infinite;
}
@keyframes ns-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.ns-pill__label {
  line-height: 1;
}

/* ---- 展开态 ---- */
.ns-panel {
  position: fixed;
  z-index: 2147483646;
  width: 280px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  font-family: system-ui, sans-serif;
  font-size: 13px;
  user-select: none;
  color: #303133;
}
.ns-panel__header {
  background: #1f71e0;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px 8px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
}
.ns-panel__title {
  font-size: 13px;
  font-weight: 600;
}
.ns-panel__minus {
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
}
.ns-panel__body {
  padding: 10px 12px;
}
.ns-row {
  display: flex;
  justify-content: space-between;
  margin: 5px 0;
  align-items: center;
  font-size: 12px;
  gap: 8px;
}
.ns-row > span:first-child {
  color: #606266;
  flex-shrink: 0;
}
.ns-row > strong {
  text-align: right;
  word-break: break-all;
}
.ns-status {
  font-weight: 600;
}
.ns-status--idle {
  color: #67c23a;
}
.ns-status--working {
  color: #1f71e0;
}
.ns-status--error {
  color: #e04e4e;
}
.ns-phase {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: #606266;
}
.ns-message {
  font-size: 11px;
  color: #909399;
  font-weight: normal;
}
.ns-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  margin-left: 4px;
}
.ns-badge--pending {
  background: #fdf6ec;
  color: #e6a23c;
}
.ns-badge--err {
  background: #fef0f0;
  color: #f56c6c;
}
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
.ns-toggle--on {
  background: #67c23a;
  border-color: #67c23a;
  color: #fff;
}
.ns-account {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.ns-account--off {
  color: #909399;
  font-weight: normal;
}
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
.ns-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
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
.ns-actions button:hover:not(:disabled) {
  background: #e9e9eb;
}
.ns-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ns-btn--primary {
  background: #1f71e0 !important;
  color: #fff !important;
  border-color: #1f71e0 !important;
}
.ns-btn--primary:hover:not(:disabled) {
  background: #1860c2 !important;
}
.ns-btn--danger {
  color: #e04e4e !important;
}

/* ---- Modal ---- */
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
.ns-modal__close {
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: #909399;
}
.ns-modal__close:hover {
  color: #303133;
}
.ns-modal__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
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
.ns-modal__footer button:hover:not(:disabled) {
  background: #e9e9eb;
}
.ns-modal__footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ns-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ns-field span {
  font-size: 12px;
  color: #606266;
}
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
.ns-field input:focus {
  border-color: #1f71e0;
}
.ns-field input:disabled {
  background: #f4f4f5;
  cursor: not-allowed;
}
.ns-error {
  margin: 0;
  color: #e04e4e;
  font-size: 12px;
}
.ns-hint {
  margin: 0;
  color: #909399;
  font-size: 12px;
}
</style>
