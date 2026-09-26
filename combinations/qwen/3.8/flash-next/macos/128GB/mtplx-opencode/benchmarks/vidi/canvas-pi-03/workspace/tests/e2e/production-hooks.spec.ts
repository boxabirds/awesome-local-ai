// Story 4, Task 7 — the storage test hooks must NOT exist in production.
//
// The hooks are real code and they can read a board's whole storage state, so
// "it is behind a flag" is only worth something if the flag is off by default
// AND the probe would notice if it weren't. Both halves are checked here, on
// workerd instances this spec starts itself (see helpers/local-worker.ts):
//
//   * one with the shipped configuration (no `--var TEST_HOOKS:1`), where the
//     /__test/… path must never reach a Durable Object;
//   * one with the flag on, as a NEGATIVE CONTROL — if the same probe cannot
//     read the state there either, the test is lying and must fail.
//
// The bundle half of the check covers the client: no hook code, no hook paths.

import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startLocalWorker, type LocalWorker } from './helpers/local-worker';

// A syntactically valid board id: if the route existed, this request WOULD
// address that object.
const VALID_ID = 'AJqzk7mQxK7r7nTmbSBmbA';
const HOOKS = ['state', 'seed', 'compact', 'corrupt-snapshot', 'repair'];

test.describe.configure({ timeout: 240_000 });

test('the built bundle contains no test-hook code at all', () => {
  const dir = join(process.cwd(), 'dist/client/assets');
  expect(existsSync(dir), `no built assets in ${dir}`).toBe(true);
  const js = readdirSync(dir).filter((name) => name.endsWith('.js'));
  expect(js.length).toBeGreaterThan(0);
  for (const name of js) {
    const source = readFileSync(join(dir, name), 'utf8');
    // The hook paths are only ever written by the test tooling.
    expect(source, `${name} still mentions /__test/`).not.toContain('/__test/');
    expect(source, `${name} still mentions the seed hook`).not.toContain('corrupt-snapshot');
  }
});

test.describe('the storage state readout is off unless the dev server opts in', () => {
  let shipped: LocalWorker;
  let instrumented: LocalWorker;

  test.beforeAll(async () => {
    shipped = await startLocalWorker({ testHooks: false });
    instrumented = await startLocalWorker({ testHooks: true });
  });

  test.afterAll(async () => {
    await shipped?.stop();
    await instrumented?.stop();
  });

  test('nobody can read a board storage state over HTTP', async ({ request }) => {
    for (const hook of HOOKS) {
      const response = await request.get(`${shipped.origin}/__test/rooms/${VALID_ID}/${hook}`);
      // The assets layer answers (SPA document or 404) and the Worker never
      // resolves a Durable Object for the path.
      expect(response.status(), hook).toBeLessThan(500);
      const body = await response.text();
      expect(body, `${hook} leaked storage state`).not.toContain('storeStats');
      expect(body, `${hook} leaked storage state`).not.toContain('snapshotThroughSeq');
    }
  });

  test('negative control: the same probe does see state when the flag is on', async ({ request }) => {
    const response = await request.get(`${instrumented.origin}/__test/rooms/${VALID_ID}/state`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('storeStats');
  });
});
