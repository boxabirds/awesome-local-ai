// Unit tests for story 5's pure board-creation logic (share.board_api):
// the collision retry loop, the rate-limit settings parity between
// src/shared/config.ts and wrangler.jsonc, and the strength of the link code.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config.ts';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id.ts';
import { createWithRetries } from '../../src/worker/create-board.ts';

/** A generator that yields the given ids in order, then repeats the last. */
function yielding(ids: string[]): { next(): string; calls: number } {
  return {
    calls: 0,
    next() {
      const id = ids[Math.min(this.calls, ids.length - 1)]!;
      this.calls++;
      return id;
    },
  };
}

describe('createWithRetries (share.unique)', () => {
  it('TC-01 returns the third id after two collisions, calling initialize three times', async () => {
    const taken1 = newBoardId();
    const taken2 = newBoardId();
    const free = newBoardId();
    const gen = yielding([taken1, taken2, free]);
    const tried: string[] = [];
    const result = await createWithRetries(
      () => gen.next(),
      async (id) => {
        tried.push(id);
        return id === free ? 'created' : 'exists';
      },
    );
    expect(result).toEqual({ ok: true, id: free });
    expect(tried).toEqual([taken1, taken2, free]);
    expect(gen.calls).toBe(3);
  });

  it('TC-02 gives up after exactly CREATE_ID_MAX_ATTEMPTS collisions', async () => {
    const ids = Array.from({ length: CREATE_ID_MAX_ATTEMPTS }, () => newBoardId());
    const gen = yielding(ids);
    const tried: string[] = [];
    const result = await createWithRetries(
      () => gen.next(),
      async (id) => {
        tried.push(id);
        return 'exists';
      },
    );
    expect(result.ok).toBe(false);
    // Boundary: no attempt beyond the limit, and no attempt skipped.
    expect(tried).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
    expect(gen.calls).toBe(CREATE_ID_MAX_ATTEMPTS);
    expect(new Set(tried).size).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-02b a service failure from initialize aborts the loop and fails the create', async () => {
    // The HTTP mapping of this outcome is 500 create_failed (integration TC-12).
    const tried: string[] = [];
    await expect(
      createWithRetries(
        () => newBoardId(),
        async (id) => {
          tried.push(id);
          throw new Error('injected RPC failure');
        },
      ),
    ).rejects.toThrow('injected RPC failure');
    expect(tried).toHaveLength(1);
  });
});

describe('rate-limit settings parity (share.rate_limit)', () => {
  it('TC-03 wrangler.jsonc BOARD_CREATE_LIMITER mirrors the named settings', () => {
    const raw = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    const binding = findCreateLimiter(stripJsonc(raw));
    expect(binding.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(binding.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('link code strength (share.unguessable)', () => {
  it('TC-04 10,000 ids are unique, 22 characters, and uniformly distributed', () => {
    const n = 10_000;
    const ids = new Set<string>();
    for (let i = 0; i < n; i++) ids.add(newBoardId());
    expect(ids.size).toBe(n);

    // Every id is the base64url encoding of BOARD_ID_BYTES (128 bits) of randomness.
    expect(BOARD_ID_BYTES * 8).toBe(128);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    }

    // No shared prefixes beyond what chance predicts: bucket the first four
    // characters (24 bits of the id) and check uniformity with a chi-square
    // goodness-of-fit test against the uniform distribution over 100 buckets.
    const buckets = 100;
    const counts = new Array<number>(buckets).fill(0);
    for (const id of ids) counts[bucketOfFirst4(id) % buckets]++;
    const expected = n / buckets;
    let chi2 = 0;
    for (const c of counts) chi2 += ((c - expected) ** 2) / expected;
    // chi-square critical value for 99 degrees of freedom at p = 0.001 is 140.17:
    // exceeding it would mean the codes are not uniform with p < 0.001.
    expect(chi2).toBeLessThan(140.17);
  });
});

/** First four id characters, read as a base64url number, for prefix bucketing. */
function bucketOfFirst4(id: string): number {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let value = 0;
  for (const ch of id.slice(0, 4)) value = value * 64 + alphabet.indexOf(ch);
  return value;
}

/** Strip line and block comments from a .jsonc source so it can be JSON.parse'd. */
function stripJsonc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
}

interface RatelimitBinding {
  name: string;
  simple: { limit: number; period: number };
}

function findCreateLimiter(src: string): RatelimitBinding {
  const config = JSON.parse(src) as {
    ratelimits?: RatelimitBinding[];
    unsafe?: { bindings?: { type?: string; name: string; simple?: { limit: number; period: number } }[] };
  };
  const top = config.ratelimits?.find((b) => b.name === 'BOARD_CREATE_LIMITER');
  if (top) return top;
  const unsafe = config.unsafe?.bindings?.find(
    (b) => b.name === 'BOARD_CREATE_LIMITER' && b.type === 'ratelimit' && b.simple,
  );
  if (!unsafe?.simple) throw new Error('no BOARD_CREATE_LIMITER ratelimit binding in wrangler.jsonc');
  return { name: unsafe.name, simple: unsafe.simple };
}
