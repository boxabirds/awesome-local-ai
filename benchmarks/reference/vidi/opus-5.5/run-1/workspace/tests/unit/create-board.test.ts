import { describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '../../src/shared/config';
import { createWithRetries, type InitializeResult } from '../../src/worker/create-board';
import { readWranglerConfig } from './helpers/jsonc';

const GENERATED_COUNT = 10_000;
const BITS_PER_BYTE = 8;
const MIN_ID_BITS = 128;
const ID_LENGTH = 22;
const PREFIX_LENGTH = 4;
const ALPHABET_SIZE = 64;
/** Chi-square critical value, 63 degrees of freedom, p = 0.001. */
const CHI_SQUARE_63_P001 = 103.44;
/**
 * Shared 4-character prefixes among 10,000 random ids: pairs ~ Poisson(n²/2 / 64⁴) ≈ 2.98.
 * P(pairs ≥ 12) < 0.001 and a prefix shared by 4 ids has probability ~1e-5.
 */
const MAX_PREFIX_PAIRS = 11;
const MAX_PREFIX_BUCKET = 3;

/** Generator yielding `ids` in order. */
function sequence(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++]!;
}

describe('createWithRetries', () => {
  it('TC-01 taken, taken, free → third id after 3 initialize calls', async () => {
    const ids = ['taken-1', 'taken-2', 'free-3'];
    const tryInitialize = vi.fn(async (id: string): Promise<InitializeResult> => (id.startsWith('taken') ? 'exists' : 'created'));
    const result = await createWithRetries(sequence(ids), tryInitialize, 3);
    expect(result).toEqual({ ok: true, id: 'free-3' });
    expect(tryInitialize).toHaveBeenCalledTimes(3);
    expect(tryInitialize.mock.calls.map((c) => c[0])).toEqual(ids);
  });

  it('TC-02 taken CREATE_ID_MAX_ATTEMPTS times → failure after exactly that many attempts', async () => {
    const generate = vi.fn(() => newBoardId());
    const tryInitialize = vi.fn(async () => 'exists' as const);
    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(generate).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
    expect(tryInitialize).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-02 boundary: success on the last allowed attempt', async () => {
    let calls = 0;
    const tryInitialize = vi.fn(async (): Promise<InitializeResult> => (++calls === CREATE_ID_MAX_ATTEMPTS ? 'created' : 'exists'));
    const result = await createWithRetries(newBoardId, tryInitialize);
    expect(result.ok).toBe(true);
    expect(tryInitialize).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
  });
});

describe('TC-03 rate-limit settings parity', () => {
  it('wrangler.jsonc BOARD_CREATE_LIMITER matches BOARD_CREATE_LIMIT / BOARD_CREATE_PERIOD_SECONDS', () => {
    const config = readWranglerConfig<{
      ratelimits?: { name: string; simple: { limit: number; period: number } }[];
    }>();
    const binding = config.ratelimits?.find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(binding).toBeDefined();
    expect(binding!.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(binding!.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('TC-04 link code strength', () => {
  const ids = Array.from({ length: GENERATED_COUNT }, () => newBoardId());

  it('ids carry at least 128 random bits and are all distinct, 22 chars', () => {
    expect(BOARD_ID_BYTES * BITS_PER_BYTE).toBeGreaterThanOrEqual(MIN_ID_BITS);
    expect(new Set(ids).size).toBe(GENERATED_COUNT);
    for (const id of ids) {
      expect(id).toHaveLength(ID_LENGTH);
      expect(id).toMatch(BOARD_ID_PATTERN);
    }
  });

  it('each of the first 4 characters is uniform over 64 symbols (chi-square, p > 0.001)', () => {
    const expected = GENERATED_COUNT / ALPHABET_SIZE;
    for (let pos = 0; pos < PREFIX_LENGTH; pos += 1) {
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id[pos]!, (counts.get(id[pos]!) ?? 0) + 1);
      let chi = 0;
      for (let s = 0; s < ALPHABET_SIZE; s += 1) {
        const symbol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[s]!;
        const observed = counts.get(symbol) ?? 0;
        chi += (observed - expected) ** 2 / expected;
      }
      expect(chi, `position ${pos}`).toBeLessThan(CHI_SQUARE_63_P001);
    }
  });

  it('shared 4-character prefixes are no more common than chance predicts', () => {
    const buckets = new Map<string, number>();
    for (const id of ids) {
      const prefix = id.slice(0, PREFIX_LENGTH);
      buckets.set(prefix, (buckets.get(prefix) ?? 0) + 1);
    }
    let pairs = 0;
    let max = 0;
    for (const n of buckets.values()) {
      pairs += (n * (n - 1)) / 2;
      max = Math.max(max, n);
    }
    expect(max).toBeLessThanOrEqual(MAX_PREFIX_BUCKET);
    expect(pairs).toBeLessThanOrEqual(MAX_PREFIX_PAIRS);
  });
});
