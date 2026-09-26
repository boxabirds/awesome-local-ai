/**
 * Story 5, task 1 (test-first): unit tests for board creation.
 *
 *  TC-01  create-with-retry: 'exists' twice, then 'created' → ok with the
 *         third id.
 *  TC-02  create-with-retry: N consecutive 'exists' → { ok: false }, no id.
 *  TC-03  wrangler.jsonc ratelimits parity with config.
 *  TC-04  newBoardId: 10,000 draws are unique, 22 chars, and their 4-char
 *         prefixes pass a chi-square uniformity test.
 *
 * TC-01/TC-02 fail against the task-1 stubs with 'not implemented' and pass
 * once task 2 implements createWithRetries.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
} from '../../src/shared/config';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createWithRetries } from '../../src/worker/create-board';

test('TC-01: create-with-retry recovers from taken ids and returns the free one', async () => {
  const id1 = 'a'.repeat(22);
  const id2 = 'b'.repeat(22);
  const id3 = 'c'.repeat(22);
  const sequence = [id1, id2, id3];
  const generate = vi.fn(() => sequence.shift()!);
  const initialize = vi.fn(async (id: string) =>
    id === id3 ? 'created' : 'exists',
  );

  const result = await createWithRetries(generate, initialize, 3);

  expect(result).toEqual({ ok: true, id: id3 });
  expect(generate).toHaveBeenCalledTimes(3);
  expect(initialize).toHaveBeenCalledTimes(3);
  expect(initialize).toHaveBeenNthCalledWith(1, id1);
  expect(initialize).toHaveBeenNthCalledWith(2, id2);
  expect(initialize).toHaveBeenNthCalledWith(3, id3);
});

test('TC-02: create-with-retry fails after maxAttempts collisions and yields no id', async () => {
  const generate = vi.fn(() => 'taken');
  const initialize = vi.fn(async () => 'exists' as const);

  const result = await createWithRetries(generate, initialize, 2);

  expect(result).toEqual({ ok: false });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(initialize).toHaveBeenCalledTimes(2);
});

test('TC-03: wrangler.jsonc ratelimits binding matches the config values', () => {
  const wranglerPath = fileURLToPath(
    new URL('../../wrangler.jsonc', import.meta.url),
  );
  const raw = readFileSync(wranglerPath, 'utf8');
  // The file has no string literals containing "//", so a naive line-comment
  // strip is safe here.
  const config = JSON.parse(raw.replace(/\/\/[^\n]*/g, '')) as {
    ratelimits?: Array<{
      name?: string;
      namespace_id?: string;
      simple?: { limit?: number; period?: number };
    }>;
  };

  const entry = (config.ratelimits ?? []).find(
    (r) => r.name === 'BOARD_CREATE_LIMITER',
  );
  expect(entry, 'wrangler.jsonc must declare a BOARD_CREATE_LIMITER ratelimit').toBeDefined();
  expect(typeof entry?.namespace_id, 'the binding needs a namespace_id string').toBe('string');
  expect(entry?.simple?.limit).toBe(BOARD_CREATE_LIMIT);
  expect(entry?.simple?.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
});

test('TC-04: 10,000 newBoardId draws are unique, 22 chars, and uniformly distributed', () => {
  const draws = 10_000;
  const ids = Array.from({ length: draws }, () => newBoardId());

  // Uniqueness (128-bit space: collisions are effectively impossible).
  expect(new Set(ids).size).toBe(draws);

  // Shape: exactly 22 unpadded base64url characters (BOARD_ID_PATTERN).
  for (const id of ids) {
    expect(id).toMatch(BOARD_ID_PATTERN);
  }

  // Uniformity: chi-square test over the 4-char prefixes (64^4 buckets).
  // With draws = 10,000 only ~10,000 buckets are occupied, so the standard
  // "expected per bucket" form is used with df = M - 1:
  //   chi2 = (M - occupied) * E + sum_occupied (c - E)^2 / E,   E = draws / M
  // Under the null this is ~chi2(M - 1); we only need the survival function
  // to be far from 0 for a well-behaved generator.
  const prefixCounts = new Map<string, number>();
  for (const id of ids) {
    const p = id.slice(0, 4);
    prefixCounts.set(p, (prefixCounts.get(p) ?? 0) + 1);
  }
  const buckets = 64 ** 4;
  const expected = draws / buckets;
  const occupied = prefixCounts.size;
  let chi2 = (buckets - occupied) * expected;
  for (const count of prefixCounts.values()) {
    chi2 += ((count - expected) ** 2) / expected;
  }
  const df = buckets - 1;
  const pValue = chiSquareSurvival(chi2, df);
  expect(pValue, `chi2=${chi2} (df=${df})`).toBeGreaterThan(0.001);
});

/**
 * Wilson-Hilferty normal approximation to the chi-square survival function:
 * P(X > x) ≈ 1 - Φ(z), z = (cbrt(x/df) - (1 - 1/(9·df))) / sqrt(1/(9·df)).
 * Accurate to well within our loose threshold (0.001) for df in the millions.
 */
function chiSquareSurvival(x: number, df: number): number {
  const z =
    (Math.cbrt(x / df) - (1 - 1 / (9 * df))) / Math.sqrt(1 / (9 * df));
  return 1 - normalCdf(z);
}

/** Abramowitz & Stegun 7.1.26: |error| < 7.5e-8. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
