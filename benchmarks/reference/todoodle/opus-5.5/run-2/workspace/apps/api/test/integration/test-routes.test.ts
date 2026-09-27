import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { TEST_RESET_TABLES } from '../../src/routes/test';
import { CLIENT_HEADERS, countScratchRows, createScratchRows, ORIGIN, SCRATCH_TABLE } from '../helpers';

beforeEach(() => {
  TEST_RESET_TABLES.push(SCRATCH_TABLE);
});
afterEach(() => {
  TEST_RESET_TABLES.splice(TEST_RESET_TABLES.indexOf(SCRATCH_TABLE), 1);
});

// Typed as an incoming request so it can be handed straight to the Worker's fetch handler.
const reset = () =>
  new Request<unknown, IncomingRequestCfProperties>(`${ORIGIN}/test/reset`, {
    method: 'POST',
    headers: CLIENT_HEADERS,
  });

describe('test-only routes outside production', () => {
  it('TC-T01 local: POST /test/reset empties registered tables', async () => {
    await createScratchRows(3);
    expect(await countScratchRows()).toBe(3);
    const res = await SELF.fetch(reset());
    expect(res.status).toBe(200);
    expect(await countScratchRows()).toBe(0);
  });

  it('TC-T03 staging: POST /test/reset empties registered tables', async () => {
    await createScratchRows(3);
    expect(await countScratchRows()).toBe(3);
    const ctx = createExecutionContext();
    const res = await worker.fetch(reset(), { ...env, ENVIRONMENT: 'staging' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await countScratchRows()).toBe(0);
  });

  it('TC-T05 local: unknown test route is 404 not_found', async () => {
    const res = await SELF.fetch(`${ORIGIN}/test/unknown`, { method: 'POST', headers: CLIENT_HEADERS });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('reset still requires the client header like any mutation', async () => {
    await createScratchRows(3);
    const res = await SELF.fetch(`${ORIGIN}/test/reset`, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await countScratchRows()).toBe(3);
  });
});
