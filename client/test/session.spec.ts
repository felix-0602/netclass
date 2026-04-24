import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ActivateException,
  activate,
  clearSession,
  getOrCreateDeviceFingerprint,
  isExpired,
  loadServerBase,
  loadSession,
  maskCardkey,
  rehydrateConfig,
  saveServerBase,
  saveSession,
  type Session,
} from '../src/answer/session';

// 用 Map 模拟 GM_value，挂在 globalThis 上让 session.ts 的 readValue/writeValue 看到
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).GM_getValue = (k: string, d: string) =>
    store.has(k) ? store.get(k)! : d;
  (globalThis as Record<string, unknown>).GM_setValue = (k: string, v: string) => {
    if (v === '' || v == null) store.delete(k);
    else store.set(k, v);
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).GM_getValue;
  delete (globalThis as Record<string, unknown>).GM_setValue;
  delete (globalThis as Record<string, unknown>).GM_xmlhttpRequest;
});

const validSession: Session = {
  jwt: 'eyJ.test.jwt',
  expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
  plan: 'lifetime',
  month_exp: null,
  features: { free: ['time_padder'], paid: ['answer_bank'] },
  cardkey_preview: 'NSK-…F978',
};

describe('maskCardkey', () => {
  test('短卡密直接打码', () => {
    expect(maskCardkey('SHORT')).toBe('****');
    expect(maskCardkey('12345678')).toBe('****');
  });

  test('长卡密保留前 4 + 后 4', () => {
    expect(maskCardkey('NSK-2549400E-0742F978')).toBe('NSK-…F978');
  });

  test('去首尾空格', () => {
    expect(maskCardkey('  NSK-2549400E-0742F978  ')).toBe('NSK-…F978');
  });
});

describe('session storage round-trip', () => {
  test('save → load 完整还原', () => {
    saveSession(validSession);
    expect(loadSession()).toEqual(validSession);
  });

  test('未保存时返回 null', () => {
    expect(loadSession()).toBeNull();
  });

  test('clearSession 后再 load 为 null', () => {
    saveSession(validSession);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  test('损坏的 JSON 视为未登录', () => {
    store.set('netclass:session:v1', 'not json {');
    expect(loadSession()).toBeNull();
  });

  test('缺 jwt 字段视为未登录', () => {
    store.set('netclass:session:v1', JSON.stringify({ ...validSession, jwt: '' }));
    expect(loadSession()).toBeNull();
  });
});

describe('isExpired', () => {
  test('未来时间 → 未过期', () => {
    expect(isExpired(validSession)).toBe(false);
  });

  test('过去时间 → 过期', () => {
    const expired: Session = {
      ...validSession,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    expect(isExpired(expired)).toBe(true);
  });

  test('expires_at 解析失败视为过期', () => {
    const broken: Session = { ...validSession, expires_at: 'not-a-date' };
    expect(isExpired(broken)).toBe(true);
  });
});

describe('device fingerprint', () => {
  test('首次生成后会持久化，二次调用返回同值', () => {
    const fp1 = getOrCreateDeviceFingerprint();
    expect(fp1).toMatch(/^[0-9a-f-]{30,}$/i);
    const fp2 = getOrCreateDeviceFingerprint();
    expect(fp2).toBe(fp1);
  });

  test('不同测试间相互独立（store 已 clear）', () => {
    const fp = getOrCreateDeviceFingerprint();
    expect(store.get('netclass:device:v1')).toBe(fp);
  });
});

describe('serverBase 持久化', () => {
  test('未设置时返回默认值', () => {
    expect(loadServerBase()).toBe('http://182.254.180.181:8080');
  });

  test('保存后能取回', () => {
    saveServerBase('http://localhost:8080');
    expect(loadServerBase()).toBe('http://localhost:8080');
  });
});

describe('activate', () => {
  test('空卡密直接抛 missing_fields，不发请求', async () => {
    const gm = vi.fn();
    (globalThis as Record<string, unknown>).GM_xmlhttpRequest = gm;

    await expect(activate('   ', 'http://x')).rejects.toBeInstanceOf(ActivateException);
    expect(gm).not.toHaveBeenCalled();
  });

  test('成功响应：保存 session + 调用 setConfig（通过 rehydrate 验证）', async () => {
    const fakeResp = {
      jwt: 'jwt.token.value',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      plan: 'lifetime' as const,
      month_exp: null,
      features: { free: [], paid: [] },
    };
    (globalThis as Record<string, unknown>).GM_xmlhttpRequest = (
      opts: { onload: (r: { responseText: string; status: number; statusText: string }) => void },
    ) => {
      opts.onload({ responseText: JSON.stringify(fakeResp), status: 200, statusText: 'OK' });
    };

    const session = await activate('NSK-TEST-CARD-KEY-12345678', 'http://localhost:8080/');
    expect(session.jwt).toBe('jwt.token.value');
    expect(session.cardkey_preview).toBe('NSK-…5678');
    expect(loadSession()?.jwt).toBe('jwt.token.value');
    // serverBase 自动去尾斜杠
    expect(loadServerBase()).toBe('http://localhost:8080');
  });

  test('服务端返回 error → 抛 ActivateException 带原 code', async () => {
    (globalThis as Record<string, unknown>).GM_xmlhttpRequest = (
      opts: { onload: (r: { responseText: string; status: number; statusText: string }) => void },
    ) => {
      opts.onload({
        responseText: JSON.stringify({
          error: { code: 'invalid_cardkey', message: '卡密无效或未开通' },
        }),
        status: 401,
        statusText: 'Unauthorized',
      });
    };

    try {
      await activate('NSK-BAD-KEY-12345678', 'http://localhost:8080');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(ActivateException);
      expect((e as ActivateException).detail.code).toBe('invalid_cardkey');
    }
  });

  test('网络错误 → ActivateException(network)', async () => {
    (globalThis as Record<string, unknown>).GM_xmlhttpRequest = (opts: {
      onerror: (r: { statusText: string }) => void;
    }) => {
      opts.onerror({ statusText: 'connection refused' });
    };

    await expect(activate('NSK-X-12345678', 'http://localhost:8080'))
      .rejects.toMatchObject({ detail: { code: 'network' } });
  });

  test('非 JSON 响应 → ActivateException(bad_response)', async () => {
    (globalThis as Record<string, unknown>).GM_xmlhttpRequest = (opts: {
      onload: (r: { responseText: string; status: number; statusText: string }) => void;
    }) => {
      opts.onload({ responseText: '<html>500</html>', status: 500, statusText: 'Server Error' });
    };

    await expect(activate('NSK-X-12345678', 'http://localhost:8080'))
      .rejects.toMatchObject({ detail: { code: 'bad_response' } });
  });
});

describe('rehydrateConfig', () => {
  test('无 session 时返回 null', () => {
    expect(rehydrateConfig()).toBeNull();
  });

  test('过期 session 返回 null（不会激活 client）', () => {
    saveSession({
      ...validSession,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(rehydrateConfig()).toBeNull();
  });

  test('有效 session 返回该 session', () => {
    saveSession(validSession);
    expect(rehydrateConfig()).toEqual(validSession);
  });
});
