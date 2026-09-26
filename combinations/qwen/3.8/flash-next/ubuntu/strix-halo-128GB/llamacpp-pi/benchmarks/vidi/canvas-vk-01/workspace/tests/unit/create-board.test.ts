import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { createWithRetries } from '../../src/worker/create-board';

/**
 * Unit tests for board creation logic: collision retries, rate-limit config
 * parity, and id distribution (TC-01..TC-04).
 */

describe('createWithRetries', () => {
  it('TC-01: returns the third id after two collisions', async () => {
    const ids = ['aaa', 'bbb', 'ccc'];
    let generateCount = 0;
    const generate = () => ids[generateCount++]!;
    const results: Array<'created' | 'exists'> = ['exists', 'exists', 'created'];
    let callCount = 0;
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      const result = results[callCount]!;
      callCount += 1;
      return result;
    };

    const result = await createWithRetries(generate, tryInitialize, 3);
    expect(result).toEqual({ ok: true, id: 'ccc' });
    expect(callCount).toBe(3);
  });

  it('TC-02: returns failure after exactly CREATE_ID_MAX_ATTEMPTS collisions', async () => {
    let callCount = 0;
    const generate = () => `id-${callCount}`;
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      callCount += 1;
      return 'exists';
    };

    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(callCount).toBe(CREATE_ID_MAX_ATTEMPTS);
  });
});

describe('rate limit config parity', () => {
  it('TC-03: wrangler.jsonc ratelimits match BOARD_CREATE_LIMIT and BOARD_CREATE_PERIOD_SECONDS', () => {
    const raw = readFileSync('./wrangler.jsonc', 'utf8');
    // Strip comments for JSON parsing
    const withoutComments = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(withoutComments);
    const limiter = config.ratelimits?.find(
      (entry: { name: string }) => entry.name === 'BOARD_CREATE_LIMITER',
    );
    expect(limiter).toBeDefined();
    expect(limiter.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('id distribution', () => {
  it('TC-04: 10,000 generated ids are unique, 22 chars, and pass chi-square prefix uniformity', () => {
    const N = 10_000;
    const ids = new Set<string>();
    const prefixCounts = new Map<string, number>();

    for (let i = 0; i < N; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      ids.add(id);
      const prefix = id.slice(0, 4);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    // All unique
    expect(ids.size).toBe(N);

    // Chi-square uniformity: 64^4 = 16,777,216 possible 4-char prefixes from
    // the base64url alphabet (64 chars). With N=10,000 samples, each expected
    // bucket count is tiny. A better test groups by first character (64
    // buckets, expected count = N/64).
    // Chi-square test on first 2 characters: 64*64 = 4096 buckets.
    // With N=10000 and 4096 buckets, many buckets will be 0 or 1, which
    // invalidates chi-square. Use first character only: 64 buckets.
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const k = ALPHABET.length; // 64 buckets
    const firstCharCounts = new Map<string, number>();
    for (const id of ids) {
      const c = id[0]!;
      firstCharCounts.set(c, (firstCharCounts.get(c) ?? 0) + 1);
    }
    const expected = N / k;
    let chiSquare = 0;
    for (const c of ALPHABET) {
      const observed = firstCharCounts.get(c) ?? 0;
      chiSquare += ((observed - expected) ** 2) / expected;
    }
    // Chi-square critical value for df=63, p=0.001 is ~109.0
    // (from tables). We assert chi-square < 109, i.e. p > 0.001.
    expect(chiSquare).toBeLessThan(109);
  });
});
