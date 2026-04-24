<template>
  <div class="ns-panel" :style="positionStyle" @mousedown.stop>
    <div class="ns-panel__header" @mousedown="onDragStart">
      <span class="ns-panel__title">🥇 Netclass Sidekick</span>
      <span class="ns-panel__minus" @click="collapsed = !collapsed">
        {{ collapsed ? '▼' : '─' }}
      </span>
    </div>
    <div v-if="!collapsed" class="ns-panel__body">
      <div class="ns-row">
        <span>状态:</span>
        <strong :class="`ns-status ns-status--${status}`">{{ statusText }}</strong>
      </div>
      <div class="ns-row">
        <span>当前平台:</span>
        <strong>{{ platform || '—' }}</strong>
      </div>
      <div class="ns-row">
        <span>题库缓存:</span>
        <strong>{{ cacheStats.count }} 题 / {{ Math.round(cacheStats.bytes / 1024) }} KB</strong>
      </div>
      <div class="ns-actions">
        <button @click="$emit('open-settings')">设置</button>
        <button @click="$emit('toggle-autoplay')">
          {{ autoPlay ? '关闭刷时长' : '开启刷时长' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { cacheStats as getCacheStats } from '@/answer/cache';

defineProps<{
  platform: string | null;
  status: 'idle' | 'working' | 'error';
  autoPlay: boolean;
}>();

defineEmits<{
  'open-settings': [];
  'toggle-autoplay': [];
}>();

const collapsed = ref(false);
const pos = ref({ x: 20, y: 80 });
const positionStyle = computed(() => ({
  left: pos.value.x + 'px',
  top: pos.value.y + 'px',
}));

const cacheStats = computed(() => getCacheStats());

const statusText = computed(() =>
  ({
    idle: '空闲',
    working: '处理中',
    error: '出错',
  } as Record<string, string>),
);

let dragStart: { x: number; y: number; px: number; py: number } | null = null;

function onDragStart(e: MouseEvent) {
  dragStart = { x: e.clientX, y: e.clientY, px: pos.value.x, py: pos.value.y };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd, { once: true });
}
function onDragMove(e: MouseEvent) {
  if (!dragStart) return;
  pos.value = {
    x: dragStart.px + (e.clientX - dragStart.x),
    y: dragStart.py + (e.clientY - dragStart.y),
  };
}
function onDragEnd() {
  dragStart = null;
  document.removeEventListener('mousemove', onDragMove);
}
</script>

<style scoped>
.ns-panel {
  position: fixed;
  z-index: 100003;
  width: 280px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  font-family: system-ui, sans-serif;
  font-size: 13px;
  user-select: none;
}
.ns-panel__header {
  background: #1f71e0;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px 8px 0 0;
  display: flex;
  justify-content: space-between;
  cursor: move;
}
.ns-panel__minus {
  cursor: pointer;
}
.ns-panel__body {
  padding: 12px;
}
.ns-row {
  display: flex;
  justify-content: space-between;
  margin: 6px 0;
}
.ns-status--working {
  color: #1f71e0;
}
.ns-status--error {
  color: #e04e4e;
}
.ns-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.ns-actions button {
  flex: 1;
  padding: 6px;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
}
.ns-actions button:hover {
  background: #e9e9eb;
}
</style>
