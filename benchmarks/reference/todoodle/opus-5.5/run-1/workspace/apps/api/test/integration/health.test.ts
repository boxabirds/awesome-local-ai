import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT, expectBaselineHeaders, url } from '../support/http.ts';

const LOCAL_HEALTH = { status: 'ok', environment: 'local', version: 'dev', git_sha: 'dev', deployed_at: null };

describe('health', () => {
  it('TC-H03 GET /health reports local defaults', async () => {
    const res = await SELF.fetch(url('/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual(LOCAL_HEALTH);
    expectBaselineHeaders(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('TC-H04 GET /api/health body is byte-identical to /health', async () => {
    const [a, b] = await Promise.all([SELF.fetch(url('/health')), SELF.fetch(url('/api/health'))]);
    expect(await b.text()).toBe(await a.text());
  });

  it('TC-H05 POST /health with the client header and no body is 405 method_not_allowed', async () => {
    const res = await SELF.fetch(url('/health'), { method: 'POST', headers: CLIENT });
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: 'method_not_allowed' });
    expectBaselineHeaders(res);
  });

  it('HEAD /health succeeds', async () => {
    const res = await SELF.fetch(url('/health'), { method: 'HEAD' });
    expect(res.status).toBe(200);
  });
});
