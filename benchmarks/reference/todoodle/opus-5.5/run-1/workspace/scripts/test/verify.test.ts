import type { FetchLike } from '../deploy/types.ts';
import { describe, expect, it } from 'vitest';
import { buildHealth } from '../../apps/api/src/routes/health.ts';
import { verifyHealth } from '../deploy/verify.ts';

const OLD = '1'.repeat(40);
const NEW = '2'.repeat(40);
const TIMEOUT = 30_000;
const INTERVAL = 2000;

type Step = string | 'throw' | 500;

/** Fake fetch serving scripted health responses (real buildHealth JSON), plus a clock advanced by sleep. */
function harness(steps: Step[]) {
  let clock = 0;
  const calls = { fetch: 0, sleeps: [] as number[] };
  const fetchImpl = (async () => {
    const step = steps[Math.min(calls.fetch, steps.length - 1)]!;
    calls.fetch++;
    if (step === 'throw') throw new TypeError('fetch failed');
    if (step === 500) return new Response('upstream error', { status: 500 });
    return Response.json(buildHealth({ ENVIRONMENT: 'staging', GIT_SHA: step, APP_VERSION: 'v1.0.0' }));
  }) satisfies FetchLike;
  const opts = {
    baseUrl: 'https://staging.todoodle.test',
    expectedSha: NEW,
    env: 'staging',
    timeoutMs: TIMEOUT,
    intervalMs: INTERVAL,
    fetch: fetchImpl,
    sleep: async (ms: number) => {
      calls.sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { opts, calls };
}

describe('verifyHealth', () => {
  it('TC-V01 target sha on the first poll: ok after 1 fetch', async () => {
    const { opts, calls } = harness([NEW]);
    expect(await verifyHealth(opts)).toEqual({ ok: true });
    expect(calls.fetch).toBe(1);
    expect(calls.sleeps).toEqual([]);
  });

  it('TC-V02 old sha then target: ok after 2 fetches and 1 sleep', async () => {
    const { opts, calls } = harness([OLD, NEW]);
    expect(await verifyHealth(opts)).toEqual({ ok: true });
    expect(calls.fetch).toBe(2);
    expect(calls.sleeps).toEqual([INTERVAL]);
  });

  it('TC-V03 old sha until timeout: fails naming the env and the last seen sha', async () => {
    const { opts, calls } = harness([OLD]);
    const result = await verifyHealth(opts);
    expect(result).toMatchObject({ ok: false, lastSeenSha: OLD });
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('staging');
    expect(result.message).toContain(OLD);
    expect(calls.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TIMEOUT);
    expect(calls.fetch).toBe(TIMEOUT / INTERVAL + 1);
  });

  it('TC-V04 fetch throws, then 500, then target: transient errors keep polling', async () => {
    const { opts, calls } = harness(['throw', 500, NEW]);
    expect(await verifyHealth(opts)).toEqual({ ok: true });
    expect(calls.fetch).toBe(3);
  });

  it('never reachable: fails with no last seen sha', async () => {
    const { opts } = harness(['throw']);
    expect(await verifyHealth(opts)).toMatchObject({ ok: false, lastSeenSha: null });
  });
});
