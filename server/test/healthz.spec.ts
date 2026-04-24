import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

describe('/healthz', () => {
  test('returns protocol version + ok', async () => {
    const resp = await SELF.fetch('http://local/healthz');
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { status: string; protocol: string; time: string };
    expect(json.status).toBe('ok');
    expect(json.protocol).toMatch(/^1\./);
  });
});
