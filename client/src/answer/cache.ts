// 客户端本地题库缓存（LRU）
// 容量：最多 5MB（近似 3000-5000 题）
// 存储：GM_value（Tampermonkey 持久化 storage，跨 reload 有效）

const STORAGE_KEY = 'netclass:cache:v1';
const MAX_BYTES = 5 * 1024 * 1024;

interface CacheEntry {
  id: string;
  answer: unknown;
  confidence: number;
  source: string;
  cached_at: number;
  last_hit: number;
  size: number; // approx bytes
}

interface CacheState {
  entries: Record<string, CacheEntry>;
  order: string[]; // LRU 链，尾部最新
  total_bytes: number;
}

function load(): CacheState {
  const raw = GM_getValue(STORAGE_KEY, '') as string;
  if (!raw) return { entries: {}, order: [], total_bytes: 0 };
  try {
    return JSON.parse(raw);
  } catch {
    return { entries: {}, order: [], total_bytes: 0 };
  }
}

function save(state: CacheState): void {
  GM_setValue(STORAGE_KEY, JSON.stringify(state));
}

export function cacheGet(id: string): CacheEntry | null {
  const state = load();
  const hit = state.entries[id];
  if (!hit) return null;
  // LRU touch
  hit.last_hit = Date.now();
  const idx = state.order.indexOf(id);
  if (idx >= 0) state.order.splice(idx, 1);
  state.order.push(id);
  save(state);
  return hit;
}

export function cachePut(
  id: string,
  answer: unknown,
  confidence: number,
  source: string,
): void {
  const state = load();
  const entryJson = JSON.stringify({ id, answer, confidence, source });
  const size = entryJson.length;

  // 已存在：先移除
  if (state.entries[id]) {
    state.total_bytes -= state.entries[id].size;
    const idx = state.order.indexOf(id);
    if (idx >= 0) state.order.splice(idx, 1);
  }

  state.entries[id] = {
    id,
    answer,
    confidence,
    source,
    cached_at: Date.now(),
    last_hit: Date.now(),
    size,
  };
  state.order.push(id);
  state.total_bytes += size;

  // LRU 淘汰到 <= MAX_BYTES
  while (state.total_bytes > MAX_BYTES && state.order.length > 1) {
    const evict = state.order.shift()!;
    const e = state.entries[evict];
    if (e) {
      state.total_bytes -= e.size;
      delete state.entries[evict];
    }
  }

  save(state);
}

export function cacheStats(): { count: number; bytes: number } {
  const s = load();
  return { count: s.order.length, bytes: s.total_bytes };
}

export function cacheClear(): void {
  save({ entries: {}, order: [], total_bytes: 0 });
}
