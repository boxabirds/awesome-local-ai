import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { countScratchRows, createScratchRows, SCRATCH_TABLE } from '../helpers';

describe('test isolation', () => {
  it('TC-I06 (A) writes rows into a scratch table', async () => {
    await createScratchRows(3);
    expect(await countScratchRows()).toBe(3);
  });

  it('TC-I06 (B) sees none of the rows test A wrote', async () => {
    const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(SCRATCH_TABLE)
      .first();
    const rows = table ? await countScratchRows() : 0;
    expect(rows).toBe(0);
  });

  it('TC-I07 runs against the local environment', () => {
    expect(env.ENVIRONMENT).toBe('local');
  });
});
