/**
 * Story 5: unit tests for the pure board-creation logic (share.board_api).
 *
 * TC-01/TC-02: createWithRetries collision handling (share.unique).
 * TC-03: the wrangler.jsonc ratelimits binding mirrors the named settings in
 *        src/shared/config.ts (they must not drift).
 * TC-04: link-code strength — 10,000 generated ids are unique, 22 chars
 *        (128 bits of randomness) and their first-4-character prefix buckets
 *        are uniform within a chi-square-style bound (p > 0.001).
 */
import { describe, it, expect } from 'vitest';
// Read the raw wrangler config as a string (Vite `?raw`). Avoids node:fs/
// node:path, which the Workers/browser typecheck (no @types/node) cannot see.
import wranglerJsoncRaw from '../../wrangler.jsonc?raw';
import { createWithRetries } from 'src/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN } from 'src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from 'src/shared/config';

describe('share.board_api: createWithRetries (collision handling)', () => {
  it('TC-01: generator yields taken, taken, free → returns third id after 3 initialize calls', async () => {
    const ids = ['taken-1', 'taken-2', 'free'];
    let i = 0;
    const calls: string[] = [];
    const result = await createWithRetries(
      () => ids[i++],
      async (id) => {
        calls.push(id);
        return id.startsWith('taken') ? 'exists' : 'created';
      },
    );
    expect(result).toEqual({ ok: true, id: 'free' });
    expect(calls).toEqual(['taken-1', 'taken-2', 'free']);
  });

  it('TC-02: generator yields taken CREATE_ID_MAX_ATTEMPTS times → failure after exactly that many attempts', async () => {
    let generated = 0;
    const calls: string[] = [];
    const result = await createWithRetries(
      () => `taken-${generated++}`,
      async (id) => {
        calls.push(id);
        return 'exists';
      },
    );
    expect(result).toEqual({ ok: false });
    expect(calls).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
    expect(generated).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-02b: success on the last allowed attempt (two collisions then created)', async () => {
    const seq = ['a', 'b', 'c'];
    let i = 0;
    const result = await createWithRetries(
      () => seq[i++],
      async (id) => (id === 'c' ? 'created' : 'exists'),
    );
    expect(result).toEqual({ ok: true, id: 'c' });
  });

  it('TC-02c: RPC throws on every attempt → failure after exactly maxAttempts attempts', async () => {
    let attempts = 0;
    const result = await createWithRetries(
      () => `id-${attempts}`,
      async () => {
        attempts += 1;
        throw new Error('rpc down');
      },
    );
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-02d: an explicit maxAttempts smaller than the default is honored', async () => {
    let attempts = 0;
    const result = await createWithRetries(
      () => `id-${attempts++}`,
      async () => 'exists',
      1,
    );
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(1);
  });

  it('TC-02e: a mixed collision-then-RPC-failure sequence still recovers on a later id', async () => {
    const outcomes = new Map([
      ['a', 'exists' as const],
      ['b', 'throw' as const],
      ['c', 'created' as const],
    ]);
    const seq = ['a', 'b', 'c'];
    let i = 0;
    const result = await createWithRetries(
      () => seq[i++],
      async (id) => {
        const o = outcomes.get(id)!;
        if (o === 'throw') throw new Error('rpc down');
        return o;
      },
    );
    expect(result).toEqual({ ok: true, id: 'c' });
  });
});

/** Strips // line comments so the JSONC config can be parsed. */
function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe('share.board_api: rate-limit settings parity (TC-03)', () => {
  it('TC-03: wrangler.jsonc ratelimits mirrors BOARD_CREATE_LIMIT / BOARD_CREATE_PERIOD_SECONDS', () => {
    const raw = wranglerJsoncRaw;
    const config = parseJsonc(raw);
    const ratelimits = config.ratelimits as Array<{
      name: string;
      namespace_id: string;
      simple?: { limit: number; period: number };
    }>;
    expect(Array.isArray(ratelimits)).toBe(true);
    const binding = ratelimits.find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(binding, 'BOARD_CREATE_LIMITER binding missing from wrangler.jsonc').toBeDefined();
    expect(binding!.simple, 'simple limit/period missing').toBeDefined();
    expect(binding!.simple!.limit).toBe(BOARD_CREATE_LIMIT);
    expect(binding!.simple!.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('share.board_api: link-code strength (TC-04)', () => {
  it('TC-04: 10,000 newBoardId() are unique, 22 chars, prefix buckets uniform (p > 0.001)', () => {
    const N = 10_000;
    const ids: string[] = [];
    for (let i = 0; i < N; i++) ids.push(newBoardId());

    // All distinct (share.unique at the generator level).
    expect(new Set(ids).size).toBe(N);

    // All 22 chars: base64url of 16 random bytes (128 bits, share.unguessable).
    for (const id of ids) expect(id).toMatch(BOARD_ID_PATTERN);

    // First-4-character prefix = first 24 bits → 64^4 equally likely buckets,
    // expected count λ = N / 64^4. With 10,000 samples the max bucket count
    // is Poisson(λ)-tail bounded; require the max to stay at or below the
    // largest k with P(any bucket ≥ k) < 0.001 (chi-square-style uniformity).
    const buckets = new Map<string, number>();
    for (const id of ids) {
      const p = id.slice(0, 4);
      buckets.set(p, (buckets.get(p) ?? 0) + 1);
    }
    const bucketCount = 64 ** 4;
    const lambda = N / bucketCount;
    const poisson = (k: number): number =>
      Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
    // P(X ≥ k) for X ~ Poisson(λ)
    const tail = (k: number): number => 1 - [0, 1, 2, 3].slice(0, k).reduce((s, i) => s + poisson(i), 0);
    // Largest k whose union tail stays under 0.001 (k = 3: bucketCount *
    // P(X≥3) ≈ 5.9e-4 < 0.001; k = 4 would also pass, k = 3 is the bound).
    const maxAllowed = 3;
    expect(bucketCount * tail(maxAllowed)).toBeLessThan(0.001);
    let max = 0;
    for (const count of buckets.values()) max = Math.max(max, count);
    expect(max, `max prefix bucket ${max} exceeds the uniformity bound ${maxAllowed}`).toBeLessThanOrEqual(maxAllowed);
  });
});

function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}
