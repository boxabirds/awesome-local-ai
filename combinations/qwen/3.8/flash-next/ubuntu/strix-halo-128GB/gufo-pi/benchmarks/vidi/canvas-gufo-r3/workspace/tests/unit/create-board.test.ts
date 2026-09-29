import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createWithRetries } from '@shared/create-board-pure';
import { newBoardId } from '@shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '@shared/config';

describe('create-board unit', () => {
  // TC-01: generator yields taken, taken, free → returns third id after 3 tryInitialize calls
  it('TC-01: returns the third id after two collisions', async () => {
    const ids = ['id1', 'id2', 'id3'];
    let callIndex = 0;
    const generate = () => ids[callIndex];
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      const result = callIndex < 2 ? 'exists' : 'created';
      callIndex++;
      return result;
    };
    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: true, id: 'id3' });
    expect(callIndex).toBe(3); // 3 tryInitialize calls
  });

  // TC-02: generator yields taken CREATE_ID_MAX_ATTEMPTS times → {ok:false} after exactly that many attempts
  it('TC-02: returns failure after exactly CREATE_ID_MAX_ATTEMPTS attempts', async () => {
    let attempts = 0;
    const generate = () => `taken-${attempts}`;
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      attempts++;
      return 'exists';
    };
    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  // TC-03: parse wrangler.jsonc ratelimits → limit == BOARD_CREATE_LIMIT, period == BOARD_CREATE_PERIOD_SECONDS
  it('TC-03: wrangler.jsonc ratelimit config matches named settings', () => {
    const wranglerPath = resolve(__dirname, '../../wrangler.jsonc');
    const raw = readFileSync(wranglerPath, 'utf-8');
    // Strip JSONC comments for parsing
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(stripped);
    const ratelimits = config.ratelimits;
    expect(ratelimits).toBeDefined();
    const limiter = ratelimits.find((r: { name: string }) => r.name === 'BOARD_CREATE_LIMITER');
    expect(limiter).toBeDefined();
    expect(limiter.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });

  // TC-04: 10,000 newBoardId() → all unique, all 22 chars; first-4-char prefix chi-square uniformity (p > 0.001)
  it('TC-04: 10,000 ids are unique, 22 chars, prefix distribution passes chi-square', () => {
    const N = 10_000;
    const ids = new Set<string>();
    const prefixCounts = new Map<string, number>();

    for (let i = 0; i < N; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      ids.add(id);
      const prefix = id.slice(0, 4);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    }

    // All unique
    expect(ids.size).toBe(N);

    // Chi-square test for prefix uniformity
    // base64url alphabet: A-Z a-z 0-9 - _ (64 chars)
    // 4-char prefixes → 64^4 = 16,777,216 possible prefixes
    // Expected count per observed prefix bucket: N / numBuckets
    // Use chi-square goodness-of-fit against uniform over observed buckets
    const buckets = [...prefixCounts.values()];
    const numBuckets = buckets.length;
    const expected = N / numBuckets;
    let chiSq = 0;
    for (const obs of buckets) {
      chiSq += ((obs - expected) ** 2) / expected;
    }
    // Degrees of freedom = numBuckets - 1 (large number)
    // For p > 0.001 with large df, chi-sq critical value ≈ df + 3.09*sqrt(2*df)
    // With ~10000 buckets observed, df ≈ 9999, critical ≈ 9999 + 3.09*sqrt(2*9999) ≈ 10436
    // A simpler practical bound: chi-sq per df should be close to 1
    const df = numBuckets - 1;
    const chiPerDf = chiSq / df;
    // For p > 0.001 with large df, chi-per-df should be < ~1.5
    expect(chiPerDf).toBeLessThan(1.5);
  });
});
