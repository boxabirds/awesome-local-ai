import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { countScratchRows, createScratchRows } from '../support/http.ts';

describe('storage isolation', () => {
  it('TC-I06 test A inserts rows', async () => {
    await createScratchRows(env.DB, 3);
    expect(await countScratchRows(env.DB)).toBe(3);
  });

  it('TC-I06 test B sees none of test A rows', async () => {
    const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_scratch'").first();
    const rows = table ? await countScratchRows(env.DB) : 0;
    expect(rows).toBe(0);
  });

  it('TC-I07 the setup guard ran and the environment is local', () => {
    expect(env.ENVIRONMENT).toBe('local');
    expect(env.TEST_BASE_ENVIRONMENT).toBe('local');
    expect(env.TEST_SIMULATED_ENVIRONMENT).toBeUndefined();
  });
});
