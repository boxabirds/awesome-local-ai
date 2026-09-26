import { SELF, env } from 'cloudflare:test';
import { beforeAll, expect } from 'vitest';
import { TEST_RESET_TABLES } from '../../src/routes/test.ts';
import { CLIENT, SCRATCH_TABLE, countScratchRows, createScratchRows, url } from './http.ts';

/** Registers the scratch table with /test/reset, as later stories register their real tables. */
export function registerScratchTableForReset() {
  beforeAll(() => {
    if (!TEST_RESET_TABLES.includes(SCRATCH_TABLE)) TEST_RESET_TABLES.push(SCRATCH_TABLE);
  });
}

export async function resetWithThreeRows(): Promise<Response> {
  await createScratchRows(env.DB, 3);
  expect(await countScratchRows(env.DB)).toBe(3);
  return SELF.fetch(url('/test/reset'), { method: 'POST', headers: CLIENT });
}
