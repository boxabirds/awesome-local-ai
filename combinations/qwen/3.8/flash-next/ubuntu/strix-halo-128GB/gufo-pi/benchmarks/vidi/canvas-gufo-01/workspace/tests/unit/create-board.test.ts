import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { createWithRetries, type InitializeResult } from '../../src/worker/create-board';

/** JSONC -> JSON: the wrangler config carries comments. */
function parseJsonc(text: string): Record<string, unknown> {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe('createWithRetries (TC-01, TC-02)', () => {
  it('TC-01 returns the third id after two collisions, calling initialize three times', async () => {
    const taken = ['taken-1', 'taken-2'];
    const generated = ['taken-1', 'taken-2', 'fresh-3'];
    let index = 0;
    const initialized: string[] = [];
    const result = await createWithRetries(
      () => generated[index++]!,
      async (id) => {
        initialized.push(id);
        return (taken.includes(id) ? 'exists' : 'created') satisfies InitializeResult;
      },
    );
    expect(result).toEqual({ ok: true, id: 'fresh-3' });
    expect(initialized).toEqual(['taken-1', 'taken-2', 'fresh-3']);
  });

  it('TC-02 fails after exactly CREATE_ID_MAX_ATTEMPTS collisions', async () => {
    const initialize = vi.fn(async (_id: string): Promise<InitializeResult> => 'exists');
    const generate = vi.fn((): string => 'always-taken');
    const result = await createWithRetries(generate, initialize);
    expect(result).toEqual({ ok: false });
    expect(initialize).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
    expect(generate).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
  });

  it('succeeds on the last allowed attempt', async () => {
    let n = 0;
    const result = await createWithRetries(
      () => `id-${n}`,
      async () => (++n === CREATE_ID_MAX_ATTEMPTS ? 'created' : 'exists'),
    );
    expect(result).toEqual({ ok: true, id: `id-${CREATE_ID_MAX_ATTEMPTS - 1}` });
  });

  it('stops immediately when initialize throws (RPC failure)', async () => {
    const initialize = vi.fn(async (_id: string): Promise<InitializeResult> => {
      throw new Error('rpc down');
    });
    await expect(createWithRetries(() => 'x', initialize)).rejects.toThrow('rpc down');
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

describe('wrangler.jsonc rate limit (TC-03)', () => {
  it('declares the same limit and period as the named settings', () => {
    const config = parseJsonc(readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf8'));
    const limits = config['ratelimits'] as {
      name: string;
      namespace_id: string;
      simple: { limit: number; period: number };
    }[];
    const limiter = limits.find((entry) => entry.name === 'BOARD_CREATE_LIMITER');
    expect(limiter).toBeDefined();
    expect(limiter?.simple.limit).toBe(10);
    expect(limiter?.simple.period).toBe(60);
    expect(limiter?.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter?.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
    expect(typeof limiter?.namespace_id).toBe('string');
  });
});

describe('newBoardId (TC-04)', () => {
  const SAMPLE = 10_000;

  it('produces 22 base64url characters, all distinct, with a uniform first character', () => {
    const ids = new Set<string>();
    const firstChars = new Map<string, number>();
    for (let i = 0; i < SAMPLE; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
      firstChars.set(id[0]!, (firstChars.get(id[0]!) ?? 0) + 1);
    }
    expect(ids.size).toBe(SAMPLE);

    // Chi-square goodness of fit over the 64 possible first characters.
    // 63 degrees of freedom: p > 0.001 at chi2 = 106.13.
    const buckets = 64;
    const expected = SAMPLE / buckets;
    let chi2 = 0;
    for (let i = 0; i < buckets; i++) {
      const observed = firstChars.get(idAlphabetChar(i)) ?? 0;
      chi2 += (observed - expected) ** 2 / expected;
    }
    expect(chi2).toBeLessThan(106.13);
    // every alphabet character must actually appear
    expect(firstChars.size).toBe(buckets);
  });

  it('spreads first-4-character prefixes: no prefix repeats more than 3 times', () => {
    const prefixes = new Map<string, number>();
    for (let i = 0; i < SAMPLE; i++) {
      const prefix = newBoardId().slice(0, 4);
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
    // 24 bits of entropy in four characters: 10k samples give expected max ~3.
    let max = 0;
    for (const count of prefixes.values()) max = Math.max(max, count);
    expect(max).toBeLessThanOrEqual(3);
  });
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function idAlphabetChar(index: number): string {
  const char = ALPHABET[index];
  if (!char) throw new Error(`index ${index} outside base64url alphabet`);
  return char;
}
