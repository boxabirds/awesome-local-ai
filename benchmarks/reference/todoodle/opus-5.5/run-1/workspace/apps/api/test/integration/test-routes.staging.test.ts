import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { countScratchRows } from '../support/http.ts';
import { registerScratchTableForReset, resetWithThreeRows } from '../support/reset.ts';

registerScratchTableForReset();

it('TC-T03 POST /test/reset works on staging: 3 rows before, 0 after', async () => {
  expect(env.ENVIRONMENT).toBe('staging');
  const res = await resetWithThreeRows();
  expect(res.status).toBe(200);
  expect(await countScratchRows(env.DB)).toBe(0);
});
