// 客户端 → 服务端 API 通信
// 契约：docs/PROTOCOL.md
// 用 GM_xmlhttpRequest（跨域 + 带 cookie + 绕 CSP）

import { cacheGet, cachePut } from './cache';

export interface AnswerRequest {
  platform: 'chaoxing' | 'zhihuishu' | 'unipus';
  question_id?: string; // 平台内部 ID（超星有、U校园派生）
  hash: string; // sha256(normalized_text + image_key)，作为 D1 主键
  type: 'single' | 'multi' | 'judge' | 'fill' | 'essay';
  text: string;
  options: Array<{ label: string; text: string | null; image_ref: string | null }>;
  tex_spans: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
  composite_image_b64?: string;
  context: {
    course_id?: string;
    clazz_id?: string;
    knowledge_id?: string;
    work_id?: string;
  };
}

export type AnswerResponse =
  | {
      status: 'hit';
      answer: { value: string; raw: string[]; confidence: number };
      source: string;
      updated_at: string;
    }
  | {
      status: 'pending';
      queued_at: string;
      hint: string;
    }
  | {
      status: 'error';
      code: string;
      message: string;
    };

export interface ClientConfig {
  serverBase: string; // e.g. 'http://localhost:8080' 或 'http://182.254.180.181:8080'
  jwt: string; // 用户激活卡密后拿到的 JWT
  clientVersion: string;
  deviceFingerprint: string;
}

/** Phase 0 生产服务端默认地址（腾讯云轻量 广州）。用户可在 Panel 里改 */
export const DEFAULT_SERVER_BASE = 'http://182.254.180.181:8080';

let CONFIG: ClientConfig | null = null;

export function setConfig(cfg: ClientConfig) {
  CONFIG = cfg;
}

export async function getAnswer(req: AnswerRequest): Promise<AnswerResponse> {
  if (!CONFIG) {
    return { status: 'error', code: 'not_configured', message: '客户端未激活，去设置面板填卡密' };
  }

  // 本地 LRU 先查
  const hit = cacheGet(req.hash);
  if (hit) {
    return {
      status: 'hit',
      answer: hit.answer as any,
      source: 'local_cache',
      updated_at: new Date(hit.cached_at).toISOString(),
    };
  }

  const resp = await postJson<AnswerResponse>('/answer', req);

  // 命中就写本地 LRU
  if (resp.status === 'hit') {
    cachePut(req.hash, resp.answer, resp.answer.confidence, resp.source);
  }

  return resp;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!CONFIG) throw new Error('not_configured');
  const cfg = CONFIG;
  return new Promise<T>((resolve, reject) => {
    GM_xmlhttpRequest({
      url: cfg.serverBase + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.jwt,
        'X-Client-Version': cfg.clientVersion,
        'X-Device-Fingerprint': cfg.deviceFingerprint,
      },
      data: JSON.stringify(body),
      timeout: 15_000,
      onload: (r) => {
        try {
          resolve(JSON.parse(r.responseText) as T);
        } catch (e) {
          reject(e);
        }
      },
      onerror: (r) => reject(new Error(`network error: ${r.statusText}`)),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}
