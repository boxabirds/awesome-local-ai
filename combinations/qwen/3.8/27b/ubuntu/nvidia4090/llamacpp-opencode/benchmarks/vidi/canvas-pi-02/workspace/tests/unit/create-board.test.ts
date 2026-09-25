/**
 * Story 5 unit tests: share.board_api pure logic (TC-01 to TC-04).
 *
 * TC-01: createWithRetries collision retry
 * TC-02: createWithRetries exhaustion
 * TC-03: wrangler.jsonc ratelimits parity with named settings
 * TC-04: newBoardId distribution (128-bit, 22 chars, chi-square uniformity)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWithRetries, CREATE_ID_MAX_ATTEMPTS } from '../../src/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
} from '../../src/shared/config';

// --- TC-01: collision retry ---------------------------------------------------

describe('TC-01 createWithRetries collision retry', () => {
  it('generator yields taken, taken, free → returns third id after 3 tryInitialize calls', async () => {
    const ids = ['taken1', 'taken2', 'free3'];
    let genIdx = 0;
    const generate = () => ids[genIdx++];
    const calls: string[] = [];
    const tryInitialize = async (id: string) => {
      calls.push(id);
      return id === 'free3' ? ('created' as const) : ('exists' as const);
    };

    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: true, id: 'free3' });
    expect(calls).toEqual(['taken1', 'taken2', 'free3']);
  });
});

// --- TC-02: exhaustion --------------------------------------------------------

describe('TC-02 createWithRetries exhaustion', () => {
  it(`generator yields taken CREATE_ID_MAX_ATTEMPTS times → {ok:false} after exactly ${CREATE_ID_MAX_ATTEMPTS} attempts`, async () => {
    const ids = ['a', 'b', 'c']; // CREATE_ID_MAX_ATTEMPTS = 3
    let genIdx = 0;
    const generate = () => ids[genIdx++];
    const calls: string[] = [];
    const tryInitialize = async (id: string) => {
      calls.push(id);
      return 'exists' as const;
    };

    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(calls.length).toBe(CREATE_ID_MAX_ATTEMPTS);
  });
});

// --- TC-03: wrangler.jsonc ratelimits parity ---------------------------------

describe('TC-03 wrangler.jsonc ratelimits parity', () => {
  it('limit equals BOARD_CREATE_LIMIT and period equals BOARD_CREATE_PERIOD_SECONDS', () => {
    // Parse wrangler.jsonc (strip // and /* */ comments first).
    const raw = readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf-8');
    // Strip block comments.
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    // Strip line comments (but not inside strings — simple heuristic:
    // the wrangler.jsonc we ship has no // inside string values).
    const noLine = noBlock.replace(/^[ \t]*\/\/.*$/gm, '');
    const config = JSON.parse(noLine) as {
      ratelimits?: Array<{ name: string; simple?: { limit: number; period: number } }>;
    };
    const rl = config.ratelimits?.find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(rl, 'BOARD_CREATE_LIMITER ratelimits entry must exist in wrangler.jsonc').toBeDefined();
    expect(rl!.simple, 'simple config must exist').toBeDefined();
    expect(rl!.simple!.limit).toBe(BOARD_CREATE_LIMIT);
    expect(rl!.simple!.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

// --- TC-04: id distribution ---------------------------------------------------

/**
 * Chi-square goodness-of-fit: test that the first character of each id is
 * uniformly distributed across the 64 base64url characters.
 *
 * df = 63, critical value at alpha = 0.001 ≈ 99.19.
 */
function chiSquareFirstChar(ids: string[]): number {
  const counts = new Array(64).fill(0);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const id of ids) {
    const idx = alphabet.indexOf(id[0]);
    if (idx >= 0) counts[idx] += 1;
  }
  const expected = ids.length / 64;
  let chi2 = 0;
  for (let i = 0; i < 64; i++) {
    chi2 += (counts[i] - expected) ** 2 / expected;
  }
  return chi2;
}

/** Critical value for chi-square with df=63 at alpha=0.001. */
const CHI2_CRIT_DF63_A0001 = 99.19;

describe('TC-04 newBoardId distribution', () => {
  it('10,000 ids: all unique, all 22 chars, first-char chi-square p > 0.001', () => {
    const N = 10_000;
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      ids.push(newBoardId());
    }

    // All unique.
    const unique = new Set(ids);
    expect(unique.size, 'all ids must be unique').toBe(N);

    // All match the pattern (22 chars).
    for (const id of ids) {
      expect(BOARD_ID_PATTERN.test(id), `id ${id} must match pattern`).toBe(true);
      expect(id.length).toBe(22);
    }

    // Chi-square uniformity on first character.
    const chi2 = chiSquareFirstChar(ids);
    expect(
      chi2,
      `first-char distribution chi-square=${chi2.toFixed(2)} exceeds critical ${CHI2_CRIT_DF63_A0001} (p<0.001)`,
    ).toBeLessThan(CHI2_CRIT_DF63_A0001);
  });
});
