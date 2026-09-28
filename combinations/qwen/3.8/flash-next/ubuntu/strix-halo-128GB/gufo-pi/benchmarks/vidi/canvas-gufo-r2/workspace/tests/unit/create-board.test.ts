/**
 * Unit tests for board creation logic (TC-01 to TC-04).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWithRetries } from '../../src/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '../../src/shared/config';

// ---------------------------------------------------------------------------
// TC-01: collision retry – yields taken, taken, free → returns third id
// ---------------------------------------------------------------------------
describe('TC-01: createWithRetries collision success on last attempt', () => {
  it('returns third id after 3 tryInitialize calls', async () => {
    const ids = ['taken-1-aaaaaaaaaaaaaa', 'taken-2-aaaaaaaaaaaaaa', 'free-id-aaaaaaaaaaaaa'];
    let index = 0;
    const generate = () => ids[index];
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      const result = index < 2 ? 'exists' : 'created';
      index++;
      return result;
    };

    const result = await createWithRetries(generate, tryInitialize, 3);
    expect(result).toEqual({ ok: true, id: 'free-id-aaaaaaaaaaaaa' });
    expect(index).toBe(3); // exactly 3 calls made
  });
});

// ---------------------------------------------------------------------------
// TC-02: collision exhausted → {ok:false} after CREATE_ID_MAX_ATTEMPTS
// ---------------------------------------------------------------------------
describe('TC-02: createWithRetries all attempts collide', () => {
  it('returns failure after exactly CREATE_ID_MAX_ATTEMPTS attempts', async () => {
    let attempts = 0;
    const generate = () => `collided-${attempts}`.padEnd(22, 'x').slice(0, 22);
    const tryInitialize = async (_id: string): Promise<'created' | 'exists'> => {
      attempts++;
      return 'exists';
    };

    const result = await createWithRetries(generate, tryInitialize, CREATE_ID_MAX_ATTEMPTS);
    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(CREATE_ID_MAX_ATTEMPTS);
  });
});

// ---------------------------------------------------------------------------
// TC-03: wrangler.jsonc ratelimits parity with named settings
// ---------------------------------------------------------------------------
describe('TC-03: wrangler.jsonc ratelimits match named settings', () => {
  it('BOARD_CREATE_LIMITER limit and period match config', () => {
    const raw = readFileSync('wrangler.jsonc', 'utf-8');
    // Remove comments for JSON parsing
    const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(stripped);
    const limiter = (config.ratelimits as Array<{ name: string; simple: { limit: number; period: number } }>)
      .find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(limiter).toBeDefined();
    expect(limiter!.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter!.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

// ---------------------------------------------------------------------------
// TC-04: 10,000 newBoardId() → all unique, all 22 chars, chi-square uniformity
// ---------------------------------------------------------------------------
describe('TC-04: board ID distribution (unguessable)', () => {
  it('10,000 ids are unique, all 22 chars, prefix distribution passes chi-square (p > 0.001)', () => {
    const N = 10_000;
    const ids = new Set<string>();
    for (let i = 0; i < N; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      ids.add(id);
    }
    // All unique
    expect(ids.size).toBe(N);

    // Verify 16 random bytes = 128 bits
    expect(BOARD_ID_BYTES).toBe(16);

    // Chi-square test on first 4 characters: bucket by first char
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const k = alphabet.length; // 64 buckets
    const expected = N / k;

    // Use first 4 characters, bucket by first character only for simplicity
    // and power of the test
    const buckets = new Map<string, number>();
    for (const id of ids) {
      const ch = id[0];
      buckets.set(ch, (buckets.get(ch) ?? 0) + 1);
    }

    let chiSq = 0;
    for (const [, obs] of buckets) {
      chiSq += (obs - expected) ** 2 / expected;
    }
    // Missing buckets contribute expected^2/expected = expected each
    const missing = k - buckets.size;
    chiSq += missing * expected;

    // Chi-square critical value for df=63, p=0.001 is ~107.07
    // With 10,000 samples and truly uniform random, this should easily pass.
    expect(chiSq).toBeLessThan(107.07);
  });
});
