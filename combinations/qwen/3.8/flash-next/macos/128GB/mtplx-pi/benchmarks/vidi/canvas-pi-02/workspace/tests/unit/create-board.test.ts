/**
 * The pure half of board creation (story 5, task 1).
 *
 * What is under test is the two decisions that do not need a Worker to be
 * wrong: *how many times do we look for a free id*, and *what happens when we
 * run out*. Both are cheap to test and expensive to get wrong — a create that
 * retries forever is a storage incident, and a create that hands out an id
 * somebody already owns is one board silently eating another.
 *
 * The id generator is injected rather than stubbed at the module level because
 * real 128-bit collisions cannot be produced on demand; TC-04 then checks the
 * generator itself, separately, over 10,000 real ids.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { BOARD_ID_BYTES, BOARD_ID_LENGTH, newBoardId } from '../../src/shared/board-id';
import { createWithRetries } from '../../src/shared/create-board';

/** A generator that hands back the given ids in order, then repeats the last. */
function generator(yields: string[]): () => string {
  let index = 0;
  return () => {
    const id = (yields[index] as string) ?? (yields[yields.length - 1] as string);
    index += 1;
    return id;
  };
}

describe('createWithRetries (TC-01, TC-02)', () => {
  it('TC-01 takes the third id after two collisions', async () => {
    const taken = ['a'.repeat(22), 'b'.repeat(22)];
    const free = 'c'.repeat(22);
    const asked: string[] = [];

    const outcome = await createWithRetries(generator([...taken, free]), async (id) => {
      asked.push(id);
      return asked.length <= 2 ? 'exists' : 'created';
    });

    expect(outcome).toEqual({ ok: true, id: free });
    // Three looks, three *different* ids. Re-asking for a taken id is not a
    // retry, it is the same dead end again.
    expect(asked).toEqual([...taken, free]);
    expect(new Set(asked).size).toBe(3);
  });

  it('TC-02 gives up after exactly CREATE_ID_MAX_ATTEMPTS taken ids', async () => {
    const asked: string[] = [];
    // Every id is taken, which is the only way the attempt ceiling is reached.
    const outcome = await createWithRetries(
      () => `x${asked.length}`.padEnd(22, 'x'),
      async (id) => {
        asked.push(id);
        return 'exists';
      },
    );

    expect(outcome).toEqual({ ok: false });
    expect(asked).toHaveLength(CREATE_ID_MAX_ATTEMPTS);
  });

  it('stops at the first id when it is free', async () => {
    const asked: string[] = [];
    const outcome = await createWithRetries(() => 'f'.repeat(22), async (id) => {
      asked.push(id);
      return 'created';
    });
    expect(outcome).toEqual({ ok: true, id: 'f'.repeat(22) });
    expect(asked).toHaveLength(1);
  });

  it('treats a thrown lookup as no board, without using the other attempts', async () => {
    const asked: string[] = [];
    const outcome = await createWithRetries(
      () => 'g'.repeat(22),
      async (id) => {
        asked.push(id);
        throw new Error('storage is down');
      },
    );
    expect(outcome).toEqual({ ok: false });
    // Retrying a storage error spends the budget on the same broken storage.
    expect(asked).toHaveLength(1);
  });

  it('refuses a non-positive attempt budget instead of looping or creating', async () => {
    let calls = 0;
    const outcome = await createWithRetries(() => 'h'.repeat(22), async () => {
      calls += 1;
      return 'created';
    }, 0);
    expect(outcome).toEqual({ ok: false });
    expect(calls).toBe(0);
  });
});

describe('the creation limit is written down once (TC-03)', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8').replace(
      /\/\/[^\n]*/g,
      '',
    ),
  );

  it('TC-03 matches the rate-limit binding to the named settings', () => {
    const binding = config.ratelimits?.find(
      (entry: { name: string }) => entry.name === 'BOARD_CREATE_LIMITER',
    );
    expect(binding, 'BOARD_CREATE_LIMITER has to exist in wrangler.jsonc').toBeDefined();
    // Both numbers, in both places, or the limit that ships is not the limit
    // that was specified.
    expect(binding.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(binding.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

/** The alphabet, spelled here so the test does not borrow the answer. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * base64url of a byte string, written from the format rather than from
 * `newBoardId`.
 *
 * A property test that asks "does this look uniform" can only ever fail by
 * accident: an unbiased generator produced a lumpy sample once in a few hundred
 * runs, and the suite turns yellow for reasons nobody can reproduce. This asks a
 * question with a definite answer instead - *do the same bytes spelled two ways
 * come out the same* - which is false the moment the encoding drops a bit, and
 * true every time it does not.
 */
function encodeReference(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const chunk =
      ((bytes[index] as number) << 16) |
      (((bytes[index + 1] ?? 0) as number) << 8) |
      ((bytes[index + 2] ?? 0) as number);
    // A full group is four characters; a 2-byte tail is three; a 1-byte tail is
    // two, and that is the whole of `BOARD_ID_LENGTH = 22` for 16 bytes.
    const characters = remaining >= 3 ? 4 : remaining === 2 ? 3 : 2;
    for (let step = 0; step < characters; step += 1) {
      out += BASE64URL[(chunk >>> (18 - 6 * step)) & 0b111111] as string;
    }
  }
  return out;
}

/** mulberry32: a fixed pseudorandom stream, so the numbers above are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  }
}

/** `SAMPLES` keys of pseudorandom bytes, four words each. */
function keys(samples: number, seed: number): Uint8Array[] {
  const next = seeded(seed);
  const made: Uint8Array[] = [];
  for (let index = 0; index < samples; index += 1) {
    const bytes = new Uint8Array(BOARD_ID_BYTES);
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const word = next();
      bytes[offset] = word & 0xff;
      bytes[offset + 1] = (word >>> 8) & 0xff;
      bytes[offset + 2] = (word >>> 16) & 0xff;
      bytes[offset + 3] = (word >>> 24) & 0xff;
    }
    made.push(bytes);
  }
  return made;
}

describe('board links cannot be guessed (TC-04)', () => {
  it('spells every bit of a 128-bit key, the way the format says', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_LENGTH).toBe(22);

    for (const bytes of keys(5_000, 0x9e37_79b9)) {
      const id = newBoardId(() => bytes);
      expect(id).toHaveLength(BOARD_ID_LENGTH);
      expect(id).toBe(encodeReference(bytes));
    }
  });

  it('carries all 128 bits, and no two keys collide in the spelling', () => {
    const zero = new Uint8Array(BOARD_ID_BYTES);
    const spelled = new Map<string, string>();
    for (const key of [
      zero,
      Uint8Array.from(zero.map(() => 0xff)),
      ...Array.from({ length: 128 }, (_unused, bit) => {
        const bytes = new Uint8Array(BOARD_ID_BYTES);
        bytes[Math.floor(bit / 8)] = 1 << (bit % 8);
        return bytes;
      }),
    ]) {
      const id = newBoardId(() => key);
      // One bit moved: one character has to move with it. A key whose bits do not
      // reach the output is a key with less than it claims, and 128 bits was the
      // whole reason for making the id this long.
      const other = spelled.get(id);
      expect(other, `key spelled the same as ${other ?? 'nothing else'}`).toBeUndefined();
      spelled.set(id, [...key].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    }
    expect(spelled.size).toBe(130);
  });

  it('spells 10,000 real ids that no pattern could have produced', () => {
    // Real randomness, but only claims that cannot fail by accident. The old
    // version of this test ran a chi-square over the sample, which is a fair
    // question to ask once and an unfair one to ask on every run of the suite:
    // an unbiased generator looks lumpy about one time in two hundred, and the
    // failure looked exactly like a bug. Uniformity is pinned by the two tests
    // above, where it has a definite answer; what is left here is the thing only
    // real entropy can show.
    const ids = Array.from({ length: 10_000 }, () => newBoardId());

    // 10,000 draws from a 128-bit space collide with probability about 10^4/2^125.
    // A repeat therefore means the generator stopped being random, not that luck
    // went bad - which is exactly the failure this has to catch.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length === BOARD_ID_LENGTH)).toBe(true);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{22}$/.test(id))).toBe(true);

    for (const position of [0, 1, 2, 20]) {
      // Position 21 is not expected to hold all 64 characters: it carries the two
      // bits left over by the last group, so it has four values in the format. It
      // is checked below, against what it can actually hold, rather than skipped.
      const seen = new Set(ids.map((id) => id[position] as string));
      expect(seen.size, `position ${position}`).toBe(64);
    }
    const last = new Set(ids.map((id) => id[21] as string));
    expect([...last].sort()).toEqual(
      // ...and what it can hold is these four, which is all 8 bits of the final
      // byte arriving in the id with four unused zeroes.
      [...BASE64URL.slice(0, 64)]
        .filter((_character, index) => index % 16 === 0)
        .sort(),
    );

    // Shared prefixes, the shape the PRD names. Two ids agreeing on four
    // characters happens 1 time in 64^4, so over 10,000 ids the expected number
    // of pairs that agree is about three; a generator seeded by a counter or a
    // timestamp agrees on far more than that, and does so every time.
    const prefixes = new Map<string, number>();
    for (const id of ids) {
      const prefix = id.slice(0, 4);
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
    const shared = [...prefixes.values()].filter((count) => count > 1);
    expect(shared.reduce((total, count) => total + (count * (count - 1)) / 2, 0)).toBeLessThan(40);
  });

  it('derives nothing from order, time or a neighbouring id', () => {
    // Two ids made one after the other must not share a run of leading
    // characters the way a counter or a timestamp would.
    const pairs = Array.from({ length: 2_000 }, () => [newBoardId(), newBoardId()] as const);
    const sharedPrefix = pairs.filter(([a, b]) => {
      let length = 0;
      while (length < a.length && a[length] === b[length]) length += 1;
      return length >= 4;
    });
    // 22 characters, first four shared: 1 in 64^4 per pair, times 2,000 pairs.
    // Anything more than a handful means the two ids are not independent.
    expect(sharedPrefix.length).toBeLessThan(6);
  });
});
