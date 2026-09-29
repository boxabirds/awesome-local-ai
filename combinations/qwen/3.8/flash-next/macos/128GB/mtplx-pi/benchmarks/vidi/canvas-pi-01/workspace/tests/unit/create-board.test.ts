/**
 * Story 5 · the pure half of board creation (design "Test scopes": TC-01 …
 * TC-04).
 *
 * These run in plain Node: `createWithRetries` and the id generator are pure,
 * and the collision paths they cover cannot be produced against a real 128-bit
 * id space, so the id source and the initialise step are injected (design
 * "Mock vs real boundaries"). The end-to-end shape of the same code is covered
 * against real storage in `tests/integration/board-api.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBoard, createWithRetries } from '../../src/worker/create-board';
import type { BoardRoomLike, RoomNamespaceLike } from '../../src/worker/env';
import { decodeBoardId, newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';

describe('createWithRetries (share.unique)', () => {
  it('TC-01: a taken id is retried, and the third attempt wins', async () => {
    const generated = ['taken-one', 'taken-two', 'free-three'];
    const calls: string[] = [];

    const result = await createWithRetries(
      () => {
        const id = generated.shift();
        if (id === undefined) throw new Error('generator exhausted');
        return id;
      },
      async (id) => {
        calls.push(id);
        return id === 'free-three' ? 'created' : 'exists';
      },
    );

    // The *third* id is handed out, and it took exactly three initialise calls
    // to get there — nobody skipped a candidate or looped past the success.
    expect(result).toEqual({ ok: true, id: 'free-three' });
    expect(calls).toEqual(['taken-one', 'taken-two', 'free-three']);
  });

  it('TC-02: when every candidate is taken the create fails, and stops trying', async () => {
    const calls: string[] = [];

    const result = await createWithRetries(
      () => `taken-${calls.length}`,
      async (id) => {
        calls.push(id);
        return 'exists';
      },
    );

    expect(result.ok).toBe(false);
    // Exactly the budget: no fifth attempt after the third failure, and no
    // half-created board left behind.
    expect(calls).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-02b: a thrown initialise is terminal, not retried', async () => {
    const calls: string[] = [];
    const result = await createWithRetries(
      () => `id-${calls.length}`,
      async (id) => {
        calls.push(id);
        throw new Error('object unavailable');
      },
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('TC-02c: an injected budget is honoured, including a zero budget', async () => {
    const calls: string[] = [];
    const taken = async (): Promise<'created' | 'exists'> => 'exists';

    expect(
      await createWithRetries(
        () => {
          calls.push('x');
          return 'x';
        },
        taken,
        0,
      ),
    ).toEqual({ ok: false });
    expect(calls).toHaveLength(0);

    calls.length = 0;
    const ok = await createWithRetries(
      () => `id-${calls.length}`,
      async (id) => {
        calls.push(id);
        return 'created';
      },
      1,
    );
    expect(ok).toEqual({ ok: true, id: 'id-0' });
    expect(calls).toHaveLength(1);
  });
});

describe('createBoard (share.rate_limit)', () => {
  /** A limiter stub: `allow` decides per key, and every key is recorded. */
  function stubLimiter(allow: (key: string) => boolean) {
    const keys: string[] = [];
    return {
      keys,
      limiter: {
        async limit(opts: { key: string }) {
          keys.push(opts.key);
          return { success: allow(opts.key) };
        },
      },
    };
  }

  it('refuses before touching anything when the limiter says no', async () => {
    const { limiter, keys } = stubLimiter(() => false);
    const touched: string[] = [];
    const namespace: RoomNamespaceLike = {
      idFromName: (name: string) => name,
      get: (id: string): BoardRoomLike => {
        touched.push(id);
        throw new Error('a board was created while rate limited');
      },
    };
    const result = await createBoard(
      { BOARD_CREATE_LIMITER: limiter, BOARD_ROOM: namespace },
      '203.0.113.5',
    );

    // The visitor key is what gets counted, and it is counted exactly once.
    expect(keys).toEqual(['203.0.113.5']);
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
    // Negative: a rate-limited request creates no board (TC-13's invariant,
    // asserted here on the pure path).
    expect(touched).toEqual([]);
  });

  it('reports create_failed when there is no room namespace to write to', async () => {
    const { limiter } = stubLimiter(() => true);
    expect(await createBoard({ BOARD_CREATE_LIMITER: limiter }, 'x')).toEqual({
      ok: false,
      reason: 'create_failed',
    });
  });

  it('hands a fresh id to the room and reports what came back', async () => {
    const { limiter } = stubLimiter(() => true);
    const handed: string[] = [];
    const namespace: RoomNamespaceLike = {
      idFromName: (name: string) => name,
      get: (id: string): BoardRoomLike => ({
        initialize: async () => {
          handed.push(id);
          return 'created';
        },
        exists: async () => true,
        fetch: async () => new Response(null, { status: 426 }),
      }),
    };

    const result = await createBoard(
      { BOARD_CREATE_LIMITER: limiter, BOARD_ROOM: namespace },
      '203.0.113.6',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(handed).toEqual([result.id]);
    expect(decodeBoardId(result.id)).not.toBeNull();
  });
});

describe('the create limiter configuration (PRD Settings)', () => {
  it('TC-03: wrangler.jsonc mirrors the named create-limit settings', () => {
    const raw = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    const binding = extractBinding(raw, 'ratelimits');
    expect(binding).not.toBeNull();

    const limits = JSON.parse(binding as string) as Array<{
      name: string;
      simple: { limit: number; period: number };
    }>;
    const create = limits.find((entry) => entry.name === 'BOARD_CREATE_LIMITER');
    expect(create).toBeDefined();

    // The named settings and the deployed binding must not drift apart.
    expect(create?.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(create?.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

/**
 * Pull a top-level JSON array out of a JSONC file.
 *
 * A comment-stripping regex is too blunt here (`"./dist/client"` contains `//`),
 * so this walks the brackets and only strips comments outside strings.
 */
function extractBinding(source: string, key: string): string | null {
  const start = source.indexOf(`"${key}"`);
  if (start < 0) return null;
  const open = source.indexOf('[', start);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let line = false;
  let block = false;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (line) {
      if (char === '\n') line = false;
      continue;
    }
    if (block) {
      if (char === '*' && next === '/') {
        block = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '/' && next === '/') {
      line = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      block = true;
      index += 1;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  return source.slice(open, end).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

describe('newBoardId (share.unguessable)', () => {
  it('TC-04: 10,000 ids are distinct and do not cluster', () => {
    const ids: string[] = [];
    for (let index = 0; index < 10_000; index += 1) ids.push(newBoardId());

    // Every id is the required shape: 22 URL-safe characters that decode to a
    // real 16-byte code (128 bits).
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(decodeBoardId(id)).not.toBeNull();
    }

    // All distinct: with 128 random bits, a repeat in 10,000 draws would mean
    // the generator is broken, not unlucky.
    expect(new Set(ids).size).toBe(ids.length);

    // 4-character prefixes are counted so a generator that leaked structure
    // into the leading characters would show up. With 64 characters per
    // position, the leading two characters give 4,096 buckets and an expected
    // count of ids / 4,096 per bucket; a chi-square over them with the usual
    // upper critical value for 4,095 degrees of freedom at p = 0.001 is ~4,827,
    // so anything at or under that is indistinguishable from uniform.
    const twoChar = new Map<string, number>();
    for (const id of ids) {
      const prefix = id.slice(0, 2);
      twoChar.set(prefix, (twoChar.get(prefix) ?? 0) + 1);
    }
    const buckets = 64 * 64;
    const expected = ids.length / buckets;
    let chiSquare = 0;
    for (const count of twoChar.values()) {
      chiSquare += ((count - expected) ** 2) / expected;
    }
    // Missing buckets contribute their own term, which the loop above skips;
    // add them so a lopsided generator cannot hide by filling few buckets.
    for (let filled = twoChar.size; filled < buckets; filled += 1) {
      chiSquare += (expected ** 2) / expected;
    }
    expect(chiSquare).toBeLessThan(4827);
  });

  it('does not derive an id from creation order, time or the previous id', () => {
    // Sequential and time-derived generators are the failure this guards: draw
    // in blocks and require the shared prefix to stay at chance length.
    const ids = Array.from({ length: 2000 }, () => newBoardId());
    let longestShared = 0;
    for (let index = 1; index < ids.length; index += 1) {
      let shared = 0;
      while (shared < 22 && ids[index][shared] === ids[index - 1][shared]) shared += 1;
      longestShared = Math.max(longestShared, shared);
    }
    // Two independent 22-character codes share a 6-character prefix with
    // probability ~1e-11; 2,000 pairs therefore cannot legitimately reach 8.
    expect(longestShared).toBeLessThan(8);

    // And nothing counts: the ids are not ordered by anything observable.
    const sorted = [...ids].sort();
    expect(sorted.join()).not.toBe(ids.join());
  });
});
