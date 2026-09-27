// Story 5 — board creation unit tests (share.board_api, task 1).
//
// These are the TEST-FIRST unit tests for the pure create logic: the collision
// retry loop, the rate-limit settings parity, and the link-code strength. The
// Durable Object, the HTTP layer and SQLite are exercised separately in
// tests/integration/board-api.test.ts; here there is no runtime to boot, so
// `tryInitialize` and the id generator are injected.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { createWithRetries, createBoard } from '../../src/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

// --- TC-01: collision retry succeeds on a later attempt ---------------------

describe('createWithRetries (share.unique)', () => {
  test('TC-01: returns the third id after three tryInitialize calls', async () => {
    // The generator yields taken, taken, free. Only the LAST id is reported as
    // newly created, so the loop must call initialize three times and return
    // the third id.
    const ids = ['taken-1', 'taken-2', 'free-3'];
    const calls: string[] = [];
    const result = await createWithRetries(
      () => ids[calls.length],
      async (id) => {
        calls.push(id);
        return id === 'free-3' ? 'created' : 'exists';
      },
    );
    expect(result).toEqual({ ok: true, id: 'free-3' });
    expect(calls).toEqual(['taken-1', 'taken-2', 'free-3']);
    expect(calls.length).toBe(3);
  });

  // --- TC-02: collision attempts are capped at CREATE_ID_MAX_ATTEMPTS --------

  test('TC-02: every attempt colliding → { ok:false } after exactly maxAttempts', async () => {
    const calls: string[] = [];
    const result = await createWithRetries(
      () => newBoardId(),
      async (id) => {
        calls.push(id);
        return 'exists'; // every generated code is already taken
      },
    );
    expect(result).toEqual({ ok: false });
    expect(calls.length).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  test('TC-02b: a throwing tryInitialize is a create failure, not a crash', async () => {
    // This is the boundary for the RPC-failure path that the HTTP layer turns
    // into 500 create_failed (integration TC-12). Here it must simply resolve.
    let calls = 0;
    const result = await createWithRetries(
      () => newBoardId(),
      async () => {
        calls += 1;
        throw new Error('RPC exploded');
      },
    );
    expect(result).toEqual({ ok: false });
    expect(calls).toBe(1); // it stops at the first throw, never retries a crash
  });

  test('createWithRetries honours an explicit maxAttempts', async () => {
    const calls: string[] = [];
    const result = await createWithRetries(
      () => newBoardId(),
      async (id) => {
        calls.push(id);
        return 'exists';
      },
      1,
    );
    expect(result).toEqual({ ok: false });
    expect(calls.length).toBe(1);
  });
});

// --- TC-03: wrangler.jsonc rate-limit binding mirrors the named settings ----

describe('rate-limit settings parity', () => {
  test('TC-03: BOARD_CREATE_LIMITER limit/period equal the config settings', () => {
    const path = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url));
    const raw = readFileSync(path, 'utf8');
    // Strip // line comments and /* */ block comments before JSON.parse: the
    // file is JSONC, not JSON.
    const withoutLineComments = raw.replace(/^\s*\/\/.*$/gm, '');
    const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(withoutComments) as {
      ratelimits: Array<{
        name: string;
        namespace_id?: string;
        simple?: { limit: number; period: number };
      }>;
    };
    const limiter = config.ratelimits.find((entry) => entry.name === 'BOARD_CREATE_LIMITER');
    expect(limiter, 'a BOARD_CREATE_LIMITER binding must exist').toBeDefined();
    expect(limiter!.namespace_id, 'the limiter needs a namespace id').toBeTruthy();
    expect(limiter!.simple, 'the limiter needs a simple {limit, period} config').toBeDefined();
    expect(limiter!.simple!.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter!.simple!.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

// --- TC-04: 128-bit link codes, uniform, never reused -----------------------

describe('link-code strength (share.unguessable)', () => {
  test('TC-04: 10,000 ids are unique, 22 chars, and prefix-uniform', () => {
    const N = 10_000;
    const seen = new Set<string>();
    const ids: string[] = [];
    let allPattern = true;
    for (let i = 0; i < N; i += 1) {
      const id = newBoardId();
      if (!BOARD_ID_PATTERN.test(id)) allPattern = false;
      seen.add(id);
      ids.push(id);
    }
    // 128 bits ⇒ 16 random bytes ⇒ 22 base64url chars, no padding.
    expect(BOARD_ID_BYTES).toBe(16);
    expect(allPattern).toBe(true);
    // No duplicates across 10,000 draws (share.unique relies on this being
    // astronomically unlikely, and createBoard re-rolls on the rare collision).
    expect(seen.size).toBe(N);

    // Uniformity of the first-4-character prefix. With 10,000 draws over
    // ~16.7M possible 4-char prefixes, a good CSPRNG keeps the largest shared
    // prefix tiny (empirically 2–3); anything large would betray a non-random
    // or time-derived code.
    const prefixCounts = new Map<string, number>();
    for (const id of ids) {
      const prefix = id.slice(0, 4);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
    expect(Math.max(...prefixCounts.values())).toBeLessThanOrEqual(6);

    // Stricter chi-square on the leading character across the 64-char
    // alphabet: 63 degrees of freedom, p = 0.001 ⇒ critical value ≈ 107.18.
    const firstCharCounts = new Map<string, number>();
    for (const id of ids) {
      const c = id[0];
      firstCharCounts.set(c, (firstCharCounts.get(c) ?? 0) + 1);
    }
    const alphabet = 64;
    const expected = N / alphabet;
    let chiSquare = 0;
    for (const count of firstCharCounts.values()) {
      chiSquare += (count - expected) ** 2 / expected;
    }
    expect(chiSquare).toBeLessThan(107.18);
  });
});

// --- createBoard: rate limit + collision wiring -----------------------------

describe('createBoard', () => {
  function envWith(initialize: () => Promise<'created' | 'exists'>) {
    return {
      BOARD_ROOM: {
        idFromName: (name: string) => ({ name }),
        get: (_id: unknown) => ({ initialize }),
      },
      // No limiter binding → createBoard skips rate limiting unless injected.
    };
  }

  test('rate-limited visitor gets rate_limited and NO board is created', async () => {
    let initialized = 0;
    const env = envWith(async () => {
      initialized += 1;
      return 'created';
    });
    const result = await createBoard(env, 'ip-1', {
      limiter: { limit: async () => ({ success: false }) },
    });
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
    expect(initialized).toBe(0);
  });

  test('allowed visitor with a free id gets that id', async () => {
    const env = envWith(async () => 'created');
    const result = await createBoard(env, 'ip-2', {
      limiter: { limit: async () => ({ success: true }) },
      generate: () => newBoardId(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toMatch(BOARD_ID_PATTERN);
  });

  test('every attempt colliding → create_failed (collision exhausted)', async () => {
    const env = envWith(async () => 'exists');
    const result = await createBoard(env, 'ip-3');
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
  });

  test('a throwing initialize → create_failed, not a crash', async () => {
    const env = envWith(async () => {
      throw new Error('RPC down');
    });
    const result = await createBoard(env, 'ip-4');
    expect(result).toEqual({ ok: false, reason: 'create_failed' });
  });
});
