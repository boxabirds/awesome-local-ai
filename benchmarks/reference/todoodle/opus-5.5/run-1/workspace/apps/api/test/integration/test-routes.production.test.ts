import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { countScratchRows, expectBaselineHeaders, url } from '../support/http.ts';
import { registerScratchTableForReset, resetWithThreeRows } from '../support/reset.ts';

registerScratchTableForReset();

describe('test routes do not exist in production', () => {
  it('TC-T02 POST /test/reset is the unknown-route 404 and deletes nothing (3 rows before and after)', async () => {
    expect(env.ENVIRONMENT).toBe('production');
    const res = await resetWithThreeRows();
    const unknown = await SELF.fetch(url('/api/does-not-exist'));

    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await unknown.text());
    expectBaselineHeaders(res);
    expect(await countScratchRows(env.DB)).toBe(3);
  });

  it('TC-T04 GET /test/throw is 404, not 500', async () => {
    const res = await SELF.fetch(url('/test/throw'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });
});
