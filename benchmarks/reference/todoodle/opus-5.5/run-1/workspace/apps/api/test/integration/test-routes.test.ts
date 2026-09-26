import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT, countScratchRows, expectBaselineHeaders, url } from '../support/http.ts';
import { registerScratchTableForReset, resetWithThreeRows } from '../support/reset.ts';

registerScratchTableForReset();

describe('test routes (local)', () => {
  it('TC-T01 POST /test/reset (bodyless) empties registered tables: 3 rows before, 0 after', async () => {
    const res = await resetWithThreeRows();
    expect(res.status).toBe(200);
    expectBaselineHeaders(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await countScratchRows(env.DB)).toBe(0);
  });

  it('TC-T05 POST /test/unknown is 404 not_found', async () => {
    const res = await SELF.fetch(url('/test/unknown'), { method: 'POST', headers: CLIENT });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('POST /test/reset without the client header is 403', async () => {
    const res = await SELF.fetch(url('/test/reset'), { method: 'POST' });
    expect(res.status).toBe(403);
  });
});
