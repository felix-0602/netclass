export interface AnswerRequest {
  platform: string;
  hash: string;
  type: string;
  text: string;
  options?: Array<{ label: string; text: string }>;
  tex_spans?: Array<{ placeholder: string; latex: string | null; image_idx: number | null }>;
  composite_image_b64?: string;
  context?: Record<string, string>;
}

export interface AnswerResponse {
  status: 'hit' | 'pending' | 'error';
  answer?: { value: string; raw: string[]; confidence: number };
  source?: string;
  hint?: string;
  error?: string;
}

export interface PendingItem {
  id: string;
  platform: string;
  q_type: string;
  text: string;
  options_json: string;
  tex_spans_json: string;
  image_key: string | null;
  priority: number;
  attempts: number;
}

export interface VerifyItem {
  hash: string;
  correct: boolean;
}

export class ServerClient {
  constructor(
    private baseUrl: string,
    private adminKey: string,
    private jwt?: string,
  ) {}

  private async post<T>(path: string, body: unknown, useAdmin = false): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Version': 'orchestrator-0.1.0',
    };
    if (useAdmin) {
      headers['X-Admin-Key'] = this.adminKey;
    } else if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      'X-Admin-Key': this.adminKey,
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  async getAnswer(req: AnswerRequest): Promise<AnswerResponse> {
    return this.post<AnswerResponse>('/answer', req);
  }

  async getPending(limit = 10, platform?: string, type?: string): Promise<PendingItem[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (platform) params.set('platform', platform);
    if (type) params.set('type', type);
    return this.get<PendingItem[]>(`/admin/pending?${params}`);
  }

  async verifyResults(items: VerifyItem[]): Promise<void> {
    await this.post('/admin/verify-answer', { items }, true);
  }

  async submitAnswers(answers: Array<{
    question_hash: string;
    answer: unknown;
    platform: string;
    confidence: number;
  }>): Promise<{ submitted: number }> {
    return this.post<{ submitted: number }>('/admin/submit', { answers }, true);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
