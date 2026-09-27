// Board creation pure logic (spec: share.board_api, TC-01 to TC-04).
//
// TC-01/TC-02 drive `createWithRetries` with deterministic generators (the
// design's mock boundary: real 128-bit collisions cannot be produced); TC-03
// asserts the named settings do not drift from wrangler.jsonc; TC-04 checks
// link-code strength: 10,000 ids are unique, exactly 22 base64url chars
// (16 random bytes = 128 bits), and the first-4-char prefix buckets pass a
// chi-square uniformity test (p > 0.001).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { createWithRetries } from '../../src/worker/create-board';

// ---------------------------------------------------------------------------
// chi-square survival function (needed for TC-04's uniformity bound)
// ---------------------------------------------------------------------------

/** log(Gamma(a)) by the Lanczos approximation. */
function logGamma(a: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (a < 0.5) {
    // Reflection: Gamma(a) Gamma(1-a) = pi / sin(pi a).
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * a)) - logGamma(1 - a);
  }
  a -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (a + i);
  const t = a + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (a + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized lower incomplete gamma P(a, x) by series (x < a + 1). */
function gammaLower(a: number, x: number): number {
  const EPS = 1e-14;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 500; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Regularized upper incomplete gamma Q(a, x) by continued fraction. */
function gammaUpper(a: number, x: number): number {
  const EPS = 1e-14;
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * P(X > x) for X ~ chi-square(df). Used as a one-off bound: TC-04 fails only
 * if the observed chi-square statistic exceeds the p = 0.001 critical value.
 */
function chiSquareSurvival(x: number, df: number): number {
  if (x <= 0) return 1;
  // χ²_df = Gamma(df/2, 2), so P(χ²_df > x) = Q(df/2, x/2).
  const a = df / 2;
  const y = x / 2;
  return y < a + 1 ? 1 - gammaLower(a, y) : gammaUpper(a, y);
}

// ---------------------------------------------------------------------------
// TC-01 / TC-02: collision retry
// ---------------------------------------------------------------------------

describe('createWithRetries (share.unique)', () => {
  it('TC-01: colliding ids are retried until a free one is created', async () => {
    const taken = newBoardId();
    const free = newBoardId();
    const ids = [taken, taken, free];
    const attempts: string[] = [];
    const result = await createWithRetries(
      () => {
        const id = ids.shift();
        if (id === undefined) throw new Error('generator exhausted');
        return id;
      },
      async (id) => {
        attempts.push(id);
        return id === free ? 'created' : 'exists';
      },
    );
    expect(result).toEqual({ ok: true, id: free });
    expect(attempts).toEqual([taken, taken, free]); // exactly 3 initialize calls
  });

  it('TC-02: all attempts collide → failure after exactly CREATE_ID_MAX_ATTEMPTS attempts', async () => {
    const taken = newBoardId();
    let attempts = 0;
    const result = await createWithRetries(
      () => {
        attempts += 1;
        return taken;
      },
      async () => 'exists',
    );
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('an initialize RPC failure is not retried (service error, not a collision)', async () => {
    let attempts = 0;
    const result = await createWithRetries(
      () => newBoardId(),
      async () => {
        attempts += 1;
        throw new Error('rpc failed');
      },
    );
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TC-03: wrangler.jsonc parity
// ---------------------------------------------------------------------------

/** Strip // and /* *\/ comments outside string literals. */
function stripJsonComments(source: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
    } else if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

it('TC-03: wrangler.jsonc ratelimits mirror the named settings', () => {
  const wranglerPath = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url));
  const parsed = JSON.parse(stripJsonComments(readFileSync(wranglerPath, 'utf8'))) as {
    ratelimits?: Array<{
      name: string;
      namespace_id: string;
      simple: { limit: number; period: number };
    }>;
  };
  const limiter = parsed.ratelimits?.find((r) => r.name === 'BOARD_CREATE_LIMITER');
  expect(limiter, 'BOARD_CREATE_LIMITER ratelimits entry').toBeDefined();
  expect(limiter!.simple.limit).toBe(BOARD_CREATE_LIMIT);
  expect(limiter!.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
});

// ---------------------------------------------------------------------------
// TC-04: link codes are unguessable
// ---------------------------------------------------------------------------

it('TC-04: 10,000 board ids are unique, 22 chars, with no structure in the prefix', () => {
  const N = 10_000;
  const bucketSpace = 64 ** 4; // possible first-4-char base64url prefixes
  const ids: string[] = new Array(N);
  for (let i = 0; i < N; i++) ids[i] = newBoardId();

  // All unique (share.unguessable: no derivable pattern, no reuse in practice).
  expect(new Set(ids).size).toBe(N);

  // All exactly 22 base64url chars (16 random bytes, share.unguessable 128 bits).
  for (const id of ids) {
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  }

  // First-4-char prefix buckets: 64^4 = 16.7M buckets, expected occupancy
  // N / 64^4 ≈ 0.0006 per bucket, so the occupancy is Poisson with tiny mean.
  // "Within what chance predicts" (p > 0.001) is checked below with the
  // chi-square/Poisson identity; the sanity assertions document the bound.
  const buckets = new Map<string, number>();
  for (const id of ids) {
    const prefix = id.slice(0, 4);
    buckets.set(prefix, (buckets.get(prefix) ?? 0) + 1);
  }
  let maxBucket = 0;
  let doubleBuckets = 0;
  for (const count of buckets.values()) {
    maxBucket = Math.max(maxBucket, count);
    if (count === 2) doubleBuckets += 1;
  }

  // Chance model: each of the 64^4 buckets gets a Pois(λ) load, λ = N/64^4.
  // Using the identity P(Pois(λ) ≥ k) = P(χ²_{2k} > 2λ):
  const lambda = N / bucketSpace;
  const pTriple = 1 - chiSquareSurvival(2 * lambda, 6); // P(a bucket holds 3+)
  // Sanity: the union bound over all buckets keeps "3+ in some bucket" below
  // p = 0.001, so the assertion below cannot flake under a fair generator.
  expect(bucketSpace * pTriple).toBeLessThan(0.001);
  expect(maxBucket, 'no 4-char prefix may hold 3+ ids (p > 0.001 under chance)').toBeLessThanOrEqual(2);

  // 2-occupancy bucket counts are Pois(μ) with μ = 64^4 · P(Pois(λ) = 2);
  // allow only what the chi-square p > 0.001 tail permits.
  const mu = bucketSpace * ((lambda ** 2 * Math.exp(-lambda)) / 2);
  let allowed = 1;
  while (allowed < 100 && chiSquareSurvival(2 * mu, 2 * allowed) >= 0.001) allowed += 1;
  expect(doubleBuckets).toBeLessThan(allowed);
});
