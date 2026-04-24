// 客户端会话状态：JWT + 设备指纹 + serverBase
// 存储：GM_value（跨 reload 持久化），key 命名沿用 netclass:<name>:v<n> 风格
// 契约：与 server/src/routes/auth.ts 对齐
//
// JWT 与卡密都是凭证 —— 这层尽量不暴露明文卡密：登录成功后 GM_value 里只留
// JWT 本身（server 已经用 cardkey_hash 比对，不需要回写卡密）。

import { DEFAULT_SERVER_BASE, setConfig } from './client';

const SESSION_KEY = 'netclass:session:v1';
const DEVICE_KEY = 'netclass:device:v1';
const SERVER_KEY = 'netclass:server:v1';

const CLIENT_VERSION = '0.1.0-alpha';

export interface Session {
  jwt: string;
  expires_at: string; // ISO
  plan: 'monthly' | 'lifetime';
  month_exp: string | null; // ISO
  features: { free: string[]; paid: string[] };
  // 仅展示用：登录时记下卡密前 4 / 后 4，便于 Panel 展示绑了哪张卡
  cardkey_preview: string;
}

export type ActivateError =
  | { code: 'missing_fields'; message: string }
  | { code: 'invalid_cardkey'; message: string }
  | { code: 'cardkey_expired'; message: string }
  | { code: 'device_limit'; message: string }
  | { code: 'banned'; message: string }
  | { code: 'network'; message: string }
  | { code: 'bad_response'; message: string };

export class ActivateException extends Error {
  constructor(public readonly detail: ActivateError) {
    super(detail.message);
    this.name = 'ActivateException';
  }
}

// ---------- session ----------

export function loadSession(): Session | null {
  const raw = readValue(SESSION_KEY, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed.jwt !== 'string' || !parsed.jwt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  writeValue(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  writeValue(SESSION_KEY, '');
}

export function isExpired(session: Session, now: number = Date.now()): boolean {
  const exp = Date.parse(session.expires_at);
  if (Number.isNaN(exp)) return true;
  return exp <= now;
}

// ---------- device fingerprint ----------

/**
 * 设备指纹：首次调用时生成随机 UUID 并持久化，后续返回同一个值。
 * Phase 0 用法：server 只把它当不透明 token 来计算 3 设备绑定上限，不做硬件哈希。
 */
export function getOrCreateDeviceFingerprint(): string {
  const cached = readValue(DEVICE_KEY, '');
  if (cached) return cached;
  const fp = generateUuid();
  writeValue(DEVICE_KEY, fp);
  return fp;
}

function generateUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // happy-dom / 老环境兜底
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

// ---------- server base ----------

export function loadServerBase(): string {
  const v = readValue(SERVER_KEY, '');
  return v || DEFAULT_SERVER_BASE;
}

export function saveServerBase(base: string): void {
  writeValue(SERVER_KEY, base);
}

// ---------- activate ----------

/**
 * 用卡密换 JWT。成功时：
 *   1. 持久化 Session（含 cardkey_preview）
 *   2. 调 setConfig() 让后续 /answer 自动带 JWT
 * 失败抛 ActivateException，UI 层 catch 后展示 detail.message。
 */
export async function activate(cardkey: string, serverBase: string): Promise<Session> {
  const trimmed = cardkey.trim();
  if (!trimmed) {
    throw new ActivateException({ code: 'missing_fields', message: '卡密不能为空' });
  }
  const base = (serverBase || DEFAULT_SERVER_BASE).replace(/\/+$/, '');
  const deviceFp = getOrCreateDeviceFingerprint();

  const resp = await postAuth(base, trimmed, deviceFp);
  if ('error' in resp) {
    throw new ActivateException({
      code: resp.error.code as ActivateError['code'],
      message: resp.error.message,
    });
  }

  const session: Session = {
    jwt: resp.jwt,
    expires_at: resp.expires_at,
    plan: resp.plan,
    month_exp: resp.month_exp,
    features: resp.features,
    cardkey_preview: maskCardkey(trimmed),
  };
  saveSession(session);
  saveServerBase(base);

  setConfig({
    serverBase: base,
    jwt: resp.jwt,
    clientVersion: CLIENT_VERSION,
    deviceFingerprint: deviceFp,
  });
  return session;
}

/** 应用启动时调一次：若已有有效 JWT，直接把 client.ts 的 CONFIG 装好。 */
export function rehydrateConfig(): Session | null {
  const session = loadSession();
  if (!session || isExpired(session)) return null;
  setConfig({
    serverBase: loadServerBase(),
    jwt: session.jwt,
    clientVersion: CLIENT_VERSION,
    deviceFingerprint: getOrCreateDeviceFingerprint(),
  });
  return session;
}

export function maskCardkey(cardkey: string): string {
  const c = cardkey.trim();
  if (c.length <= 8) return '****';
  return `${c.slice(0, 4)}…${c.slice(-4)}`;
}

// ---------- internals ----------

interface AuthOk {
  jwt: string;
  expires_at: string;
  plan: 'monthly' | 'lifetime';
  month_exp: string | null;
  features: { free: string[]; paid: string[] };
}
interface AuthErr {
  error: { code: string; message: string };
}

function postAuth(
  base: string,
  cardkey: string,
  deviceFp: string,
): Promise<AuthOk | AuthErr> {
  const url = `${base}/auth`;
  const body = JSON.stringify({ cardkey, device_fingerprint: deviceFp });

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      timeout: 15_000,
      onload: (r) => {
        try {
          const parsed = JSON.parse(r.responseText) as AuthOk | AuthErr;
          resolve(parsed);
        } catch {
          reject(
            new ActivateException({
              code: 'bad_response',
              message: `服务端返回非 JSON：${r.status} ${r.statusText}`,
            }),
          );
        }
      },
      onerror: (r) =>
        reject(
          new ActivateException({
            code: 'network',
            message: `网络错误：${r.statusText || '请检查 serverBase 是否可达'}`,
          }),
        ),
      ontimeout: () =>
        reject(
          new ActivateException({
            code: 'network',
            message: '请求超时（15 秒）',
          }),
        ),
    });
  });
}

// 测试桩：vitest 里 happy-dom 没有 GM_*，这里走全局检测
function readValue(key: string, fallback: string): string {
  const g = globalThis as Record<string, unknown>;
  const fn = g.GM_getValue as ((k: string, d?: unknown) => unknown) | undefined;
  if (typeof fn === 'function') return (fn(key, fallback) as string) ?? fallback;
  return fallback;
}
function writeValue(key: string, value: string): void {
  const g = globalThis as Record<string, unknown>;
  const fn = g.GM_setValue as ((k: string, v: unknown) => void) | undefined;
  if (typeof fn === 'function') fn(key, value);
}
