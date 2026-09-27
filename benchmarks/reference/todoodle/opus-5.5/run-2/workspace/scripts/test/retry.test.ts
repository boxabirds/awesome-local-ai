import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../deploy/retry';

const BASE = 5_000;

function scripted(outcomes: ('ok' | 'fail')[]) {
  let call = 0;
  return vi.fn(async () => {
    const outcome = outcomes[call++];
    if (outcome === 'ok') return `result ${call}`;
    throw new Error(`attempt ${call} failed`);
  });
}

function harness() {
  const sleeps: number[] = [];
  const attempts: { n: number; failed: boolean }[] = [];
  return {
    sleeps,
    attempts,
    opts: (attemptCount = 3) => ({
      attempts: attemptCount,
      baseDelayMs: BASE,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      onAttempt: (n: number, err?: unknown) => attempts.push({ n, failed: err !== undefined }),
    }),
  };
}

describe('withRetry', () => {
  it('TC-R01 succeeds first time: 1 call, 0 sleeps', async () => {
    const fn = scripted(['ok']);
    const h = harness();
    await expect(withRetry(fn, h.opts())).resolves.toBe('result 1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('TC-R02 fail, fail, ok: 3 calls, backoff [base, 2*base], 3 attempts reported', async () => {
    const fn = scripted(['fail', 'fail', 'ok']);
    const h = harness();
    await expect(withRetry(fn, h.opts())).resolves.toBe('result 3');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toEqual([BASE, 2 * BASE]);
    expect(h.attempts).toEqual([
      { n: 1, failed: true },
      { n: 2, failed: true },
      { n: 3, failed: false },
    ]);
  });

  it('TC-R03 fails every time: throws the last error, 3 calls, no sleep after the final attempt', async () => {
    const fn = scripted(['fail', 'fail', 'fail']);
    const h = harness();
    await expect(withRetry(fn, h.opts())).rejects.toThrow('attempt 3 failed');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toEqual([BASE, 2 * BASE]);
  });

  it('TC-R04 attempts=1 and a failure: throws with no sleep', async () => {
    const fn = scripted(['fail']);
    const h = harness();
    await expect(withRetry(fn, h.opts(1))).rejects.toThrow('attempt 1 failed');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });
});
