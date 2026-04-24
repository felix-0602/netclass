import { describe, expect, test } from 'vitest';
import { createTestCtx } from './_helpers';

describe('/healthz', () => {
  test('返回 protocol version + ok', async () => {
    const ctx = createTestCtx();
    const resp = await ctx.fetch('/healthz');
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { status: string; protocol: string; time: string };
    expect(json.status).toBe('ok');
    expect(json.protocol).toMatch(/^1\./);
    ctx.env.rawDb.close();
  });
});
