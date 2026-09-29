// Story 5, task 1: the pure half of board creation.
//
// TC-01/TC-02 test `createWithRetries` with an injected generator and an
// injected initialize result, because a real 128-bit collision cannot be
// produced on purpose (the design's "Mock vs real boundaries" table allows
// exactly this substitution). TC-03 keeps the product setting and the platform
// binding from drifting apart. TC-04 measures the link codes themselves.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createBoard, createWithRetries, type InitializeResult } from '../../src/worker/create-board.ts';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id.ts';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config.ts';

// A generator that replays the given codes and records how often it was asked.
function scripted(ids: string[]): { generate(): string; calls: number } {
  const state = { calls: 0, generate() { return ids[Math.min(state.calls++, ids.length - 1)]; } };
  return state;
}

// An initialize that answers 'exists' for the ids in `taken` and 'created' for
// anything else, recording every id it was asked about.
function takingIds(taken: string[]): { ids: string[]; initialize(id: string): Promise<InitializeResult> } {
  const set = new Set(taken);
  const state: { ids: string[]; initialize(id: string): Promise<InitializeResult> } = {
    ids: [],
    async initialize(id: string) {
      state.ids.push(id);
      return set.has(id) ? 'exists' : 'created';
    },
  };
  return state;
}

describe('TC-01 createWithRetries retries a taken code', () => {
  it('returns the third id after three tries', async () => {
    const taken = [newBoardId(), newBoardId()];
    const free = newBoardId();
    const gen = scripted([taken[0], taken[1], free]);
    const init = takingIds(taken);

    const result = await createWithRetries(gen.generate.bind(gen), init.initialize.bind(init));

    expect(result).toEqual({ ok: true, id: free });
    // share.unique: every taken code was refused, and the free one was reached.
    expect(init.ids).toEqual([taken[0], taken[1], free]);
  });

  it('a taken code is never handed to the new board', async () => {
    // The room answers 'exists' for the code it already owns; the caller must
    // come back with no id at all rather than with somebody else's board.
    const taken = newBoardId();
    const result = await createWithRetries(
      () => taken,
      async () => 'exists',
      1,
    );
    expect(result).toEqual({ ok: false });
  });
});

describe('TC-02 createWithRetries gives up after CREATE_ID_MAX_ATTEMPTS', () => {
  it('fails after exactly that many attempts when every code is taken', async () => {
    const taken = Array.from({ length: CREATE_ID_MAX_ATTEMPTS }, () => newBoardId());
    const gen = scripted(taken);
    const init = takingIds(taken);

    const result = await createWithRetries(gen.generate.bind(gen), init.initialize.bind(init));

    expect(result).toEqual({ ok: false });
    expect(init.ids).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
  });

  it('the boundary: succeeding on the last allowed attempt still succeeds', async () => {
    const taken = Array.from({ length: CREATE_ID_MAX_ATTEMPTS - 1 }, () => newBoardId());
    const free = newBoardId();
    const gen = scripted([...taken, free]);
    const init = takingIds(taken);

    const result = await createWithRetries(gen.generate.bind(gen), init.initialize.bind(init));

    expect(result).toEqual({ ok: true, id: free });
    expect(init.ids).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
  });

  it('an initialize that throws is a create failure, not a retry storm', async () => {
    // The 500 path (contract error `create_failed`); TC-12 proves it end to end.
    let calls = 0;
    const result = await createWithRetries(newBoardId, async () => {
      calls += 1;
      throw new Error('rpc failed');
    });
    expect(result).toEqual({ ok: false });
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TC-03: the wrangler binding and the product setting are the same rule.
// ---------------------------------------------------------------------------

/** Strip // and /* *\/ comments and trailing commas from a JSONC document. */
function stripJsonc(source: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

interface WranglerRatelimit {
  name: string;
  namespace_id?: string;
  simple?: { limit?: number; period?: number };
  limit?: number;
  period?: number;
}

describe('TC-03 the rate-limit binding mirrors the named settings', () => {
  it('BOARD_CREATE_LIMITER limit == BOARD_CREATE_LIMIT, period == BOARD_CREATE_PERIOD_SECONDS', () => {
    const raw = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    const config = JSON.parse(stripJsonc(raw)) as { ratelimits?: WranglerRatelimit[] };
    const binding = (config.ratelimits ?? []).find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(binding, 'wrangler.jsonc must declare a BOARD_CREATE_LIMITER binding').toBeDefined();

    // The platform's shape nests them under `simple`; accept a flat form too so
    // the assertion is about the numbers, not about where wrangler puts them.
    const limit = binding?.simple?.limit ?? binding?.limit;
    const period = binding?.simple?.period ?? binding?.period;
    expect(limit).toBe(BOARD_CREATE_LIMIT);
    expect(period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

// ---------------------------------------------------------------------------
// TC-04: the link code is what makes a board unguessable.
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SAMPLE = 10_000;

/**
 * The chi-square goodness-of-fit critical value for `df` degrees of freedom at
 * upper-tail probability `p`, by the Wilson-Hilferty normal approximation. A
 * sample whose chi-square is below it is consistent with a uniform source at
 * that confidence level.
 */
function chiSquareCritical(df: number, p: number): number {
  // Upper quantile of the standard normal for a one-sided upper tail of p,
  // by the same transform inverted on the chi-square side. These are the two
  // values this suite needs; a lookup beats pulling in a statistics package.
  const zUpper: Record<string, number> = { '0.001': 3.0902, '0.01': 2.3263, '0.05': 1.6449 };
  const z = zUpper[String(p)];
  if (z === undefined) throw new Error(`no quantile for p=${p}`);
  const a = 2 / (9 * df);
  return df * Math.pow(1 - a + z * Math.sqrt(a), 3);
}

describe('TC-04 link codes cannot be guessed', () => {
  const ids = Array.from({ length: SAMPLE }, () => newBoardId());

  it('every code is 22 characters of base64url, from 128 bits', () => {
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      for (const ch of id) expect(BASE64URL_ALPHABET).toContain(ch);
    }
  });

  it('10,000 codes are all distinct', () => {
    // 128 bits makes a collision here a ~1e-26 event, so "all distinct" is a
    // real assertion rather than a lucky one.
    expect(new Set(ids).size).toBe(SAMPLE);
  });

  it('the first character is uniformly spread over the alphabet', () => {
    const buckets = new Map<string, number>();
    for (const id of ids) {
      const ch = id.slice(0, 1);
      buckets.set(ch, (buckets.get(ch) ?? 0) + 1);
    }
    const k = BASE64URL_ALPHABET.length;
    const expected = SAMPLE / k;
    let chi2 = 0;
    for (const ch of BASE64URL_ALPHABET) {
      const observed = buckets.get(ch) ?? 0;
      chi2 += ((observed - expected) ** 2) / expected;
    }
    // Goodness-of-fit at p > 0.001: a code derived from a counter, a timestamp
    // or a prefix of another code cannot produce this.
    expect(chi2).toBeLessThan(chiSquareCritical(k - 1, 0.001));
  });

  it('first-4-character prefixes show no shared prefix beyond chance', () => {
    const buckets = new Map<string, number>();
    for (const id of ids) {
      const prefix = id.slice(0, 4);
      buckets.set(prefix, (buckets.get(prefix) ?? 0) + 1);
    }
    // There are 64^4 = 16,777,216 four-character prefixes, so 10,000 codes put
    // an expected 0.0006 of them in any bucket: the largest bucket is a handful
    // at the very outside of chance, and the number of codes that share a
    // prefix with another code is a few.
    const bucketsFor = Math.pow(BASE64URL_ALPHABET.length, 4);
    const lambda = SAMPLE / bucketsFor;
    let maxBucket = 0;
    let shared = 0;
    for (const count of buckets.values()) {
      maxBucket = Math.max(maxBucket, count);
      if (count > 1) shared += count;
    }
    // P(Poisson(0.0006) >= 6) ~ 6e-23, times 16.8M buckets: still effectively
    // never. A code derived from creation order would put all 10,000 in a
    // handful of buckets and blow this apart.
    expect(maxBucket).toBeLessThanOrEqual(5);
    expect(shared).toBeLessThanOrEqual(SAMPLE * 0.01);
    expect(lambda).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// createBoard: the visitor limit is checked before any board is created.
// ---------------------------------------------------------------------------

describe('createBoard rate limit', () => {
  it('a limited visitor is refused before a code is created', async () => {
    let generated = 0;
    let initialized = 0;
    const env = {} as unknown as Parameters<typeof createBoard>[0];
    const result = await createBoard(env, '203.0.113.7', {
      limiter: { async limit() { return { success: false }; } },
      generate: () => {
        generated += 1;
        return newBoardId();
      },
      initialize: async () => {
        initialized += 1;
        return 'created';
      },
    });
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
    expect(generated).toBe(0);
    expect(initialized).toBe(0);
  });

  it('an allowed visitor gets a code that the room accepted', async () => {
    const id = newBoardId();
    const env = {} as unknown as Parameters<typeof createBoard>[0];
    const result = await createBoard(env, '203.0.113.8', {
      limiter: { async limit() { return { success: true }; } },
      generate: () => id,
      initialize: async () => 'created',
    });
    expect(result).toEqual({ ok: true, id });
  });

  it('codes exhausted is a create failure, not a rate limit', async () => {
    const env = {} as unknown as Parameters<typeof createBoard>[0];
    const result = await createBoard(env, '203.0.113.9', {
      limiter: { async limit() { return { success: true }; } },
      generate: newBoardId,
      initialize: async () => 'exists',
    });
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
  });
});
