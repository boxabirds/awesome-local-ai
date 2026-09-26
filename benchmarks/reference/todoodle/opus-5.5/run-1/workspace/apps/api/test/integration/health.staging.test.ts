import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { url } from '../support/http.ts';

it('TC-H06 reports the injected staging release metadata', async () => {
  const res = await SELF.fetch(url('/health'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    status: 'ok',
    environment: 'staging',
    version: 'v1.2.0',
    git_sha: '0123456789abcdef0123456789abcdef01234567',
    deployed_at: '2026-09-25T12:34:56.000Z',
  });
});
