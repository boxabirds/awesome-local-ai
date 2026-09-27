import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_RESET_TABLES } from '../../src/routes/test';
import { CLIENT_HEADERS, countScratchRows, createScratchRows, ORIGIN, SCRATCH_TABLE } from '../helpers';

beforeEach(() => {
  TEST_RESET_TABLES.push(SCRATCH_TABLE);
});
afterEach(() => {
  TEST_RESET_TABLES.splice(TEST_RESET_TABLES.indexOf(SCRATCH_TABLE), 1);
});

describe('test-only routes in production', () => {
  it('runs with ENVIRONMENT=production', async () => {
    expect(env.ENVIRONMENT).toBe('production');
    expect(await (await SELF.fetch(`${ORIGIN}/health`)).json()).toMatchObject({ environment: 'production' });
  });

  it('TC-T02 POST /test/reset is the unknown-route 404 and deletes nothing', async () => {
    await createScratchRows(3);
    expect(await countScratchRows()).toBe(3);

    const res = await SELF.fetch(`${ORIGIN}/test/reset`, { method: 'POST', headers: CLIENT_HEADERS });
    const unknown = await SELF.fetch(`${ORIGIN}/api/nope`, { method: 'POST', headers: CLIENT_HEADERS });

    expect(res.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await res.text()).toBe(await unknown.text());
    expect(await countScratchRows()).toBe(3);
  });

  it('TC-T04 GET /test/throw is 404, not 500', async () => {
    const res = await SELF.fetch(`${ORIGIN}/test/throw`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });
});
