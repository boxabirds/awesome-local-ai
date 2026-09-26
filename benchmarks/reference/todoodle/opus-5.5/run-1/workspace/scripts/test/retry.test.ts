import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../deploy/retry.ts';

const BASE = 5000;

function scripted(outcomes: ('ok' | 'fail')[]) {
  let call = 0;
  return vi.fn(async () => {
    const outcome = outcomes[call++];
    if (outcome === 'ok') return `ok on ${call}`;
    throw new Error(`failure ${call}`);
  });
}

function recorder() {
  const sleeps: number[] = [];
  const attemptLog: [number, unknown][] = [];
  return {
    sleeps,
    attemptLog,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    onAttempt: (n: number, err?: unknown) => {
      attemptLog.push([n, err]);
    },
  };
}

describe('withRetry', () => {
  it('TC-R01 succeeds first time: 1 call, 0 sleeps', async () => {
    const fn = scripted(['ok']);
    const r = recorder();
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: BASE, sleep: r.sleep, onAttempt: r.onAttempt })).resolves.toBe('ok on 1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.sleeps).toEqual([]);
    expect(r.attemptLog).toEqual([[1, undefined]]);
  });

  it('TC-R02 fail, fail, ok: 3 calls, sleeps [base, 2*base], onAttempt 3 times', async () => {
    const fn = scripted(['fail', 'fail', 'ok']);
    const r = recorder();
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: BASE, sleep: r.sleep, onAttempt: r.onAttempt })).resolves.toBe('ok on 3');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(r.sleeps).toEqual([BASE, 2 * BASE]);
    expect(r.attemptLog.map(([n]) => n)).toEqual([1, 2, 3]);
    expect(r.attemptLog[0]?.[1]).toBeInstanceOf(Error);
    expect(r.attemptLog[2]?.[1]).toBeUndefined();
  });

  it('TC-R03 fails 3 times: throws the last error, 3 calls, 2 sleeps (none after the final attempt)', async () => {
    const fn = scripted(['fail', 'fail', 'fail']);
    const r = recorder();
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: BASE, sleep: r.sleep, onAttempt: r.onAttempt })).rejects.toThrow('failure 3');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(r.sleeps).toEqual([BASE, 2 * BASE]);
  });

  it('TC-R04 attempts=1 and failure: throws with 0 sleeps (boundary)', async () => {
    const fn = scripted(['fail']);
    const r = recorder();
    await expect(withRetry(fn, { attempts: 1, baseDelayMs: BASE, sleep: r.sleep, onAttempt: r.onAttempt })).rejects.toThrow('failure 1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.sleeps).toEqual([]);
  });
});
