import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { buildHealth } from '../../src/routes/health';
import { CLIENT_HEADERS, ORIGIN } from '../helpers';

describe('health endpoint', () => {
  it('TC-H03 /health reports local defaults', async () => {
    const res = await SELF.fetch(`${ORIGIN}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual(buildHealth({}));
    expect(buildHealth({})).toEqual({
      status: 'ok',
      environment: 'local',
      version: 'dev',
      git_sha: 'dev',
      deployed_at: null,
    });
  });

  it('TC-H04 /api/health body is byte-identical to /health', async () => {
    const a = await (await SELF.fetch(`${ORIGIN}/health`)).text();
    const b = await (await SELF.fetch(`${ORIGIN}/api/health`)).text();
    expect(b).toBe(a);
  });

  it('TC-H05 POST /health is 405 method_not_allowed', async () => {
    const res = await SELF.fetch(`${ORIGIN}/health`, { method: 'POST', headers: CLIENT_HEADERS });
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ error: 'method_not_allowed' });
  });

  it('HEAD /health succeeds without a body', async () => {
    const res = await SELF.fetch(`${ORIGIN}/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('TC-H06 reports injected staging values when the bindings say staging', async () => {
    const staging = {
      ...env,
      ENVIRONMENT: 'staging',
      APP_VERSION: 'v1.2.0',
      GIT_SHA: 'a3f9c2e1b4d5f60718293a4b5c6d7e8f90a1b2c3',
      DEPLOYED_AT: '2026-09-27T10:15:00.000Z',
    };
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${ORIGIN}/health`), staging, ctx);
    await waitOnExecutionContext(ctx);
    expect(await res.json()).toEqual({
      status: 'ok',
      environment: 'staging',
      version: 'v1.2.0',
      git_sha: 'a3f9c2e1b4d5f60718293a4b5c6d7e8f90a1b2c3',
      deployed_at: '2026-09-27T10:15:00.000Z',
    });
  });
});
