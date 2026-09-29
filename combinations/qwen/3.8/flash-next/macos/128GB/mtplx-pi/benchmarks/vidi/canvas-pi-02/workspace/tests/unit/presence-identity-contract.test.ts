import { describe, expect, it } from 'vitest';

import { IDENTITY_STORAGE_KEY, NAME_MAX_CHARS, PRESENCE_COLORS } from '../../src/shared/config';
import {
  GUEST_NAMES,
  NAME_ERROR,
  randomGuestName,
  randomIdentityId,
  readIdentity,
  readIdentity as loadIdentity,
  validateName,
  writeIdentity,
} from '../../src/client/presence/identity';

/**
 * Story 6, task 9: the identity a person arrives with.
 *
 * Three separate promises, all of them about *not* being surprising: a name
 * that tells two people apart, a rename that cannot be typed into a black hole,
 * and an identity that still works when `localStorage` is a brick wall. They
 * are tested against the module rather than through a browser because none of
 * them is a rendering question, and because a seeded generator can be replayed
 * while a real one cannot.
 */

/** A generator that is not `Math.random`, so a failure can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** A store that works, and one that throws the way private mode does. */
/** The key identity lives under, spelt once. */
const KEY = IDENTITY_STORAGE_KEY;

function storeOf(entries: Record<string, string> = {}): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly written: string[];
} {
  const data = new Map(Object.entries(entries));
  const written: string[] = [];
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
      written.push(value);
    },
    written,
  };
}

function brokenStore(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  return {
    getItem: () => {
      throw new Error('SecurityError: storage is disabled');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
}

describe('the name somebody arrives with', () => {
  it('TC-09 is two words, and short enough for a label', () => {
    const rng = seeded(20_260_925);
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const name = randomGuestName(rng);
      expect(name.split(' ')).toHaveLength(2);
      expect(name.length).toBeLessThanOrEqual(NAME_MAX_CHARS);
      // Every letter ASCII: a label that needs a font fallback is a label whose
      // width nobody measured.
      // eslint-disable-next-line no-control-regex
      expect(/^[\x20-\x7E]+$/.test(name)).toBe(true);
    }
  });

  it('TC-09 spreads a thousand people over more than a handful of names', () => {
    const rng = seeded(7);
    const names = new Set<string>();
    for (let attempt = 0; attempt < 1_000; attempt += 1) names.add(randomGuestName(rng));
    // The point of the pool is that a crowd does not collapse onto one name. Two
    // is the floor that would make the feature pointless; the pool is bigger than
    // the capacity by design, and a generator that only ever said one word would
    // pass a weaker assertion than this one.
    expect(names.size).toBeGreaterThan(10);
  });

  it('offers at least a board-full of names, and none of them repeat', () => {
    expect(GUEST_NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(GUEST_NAMES).size).toBe(GUEST_NAMES.length);
    for (const name of GUEST_NAMES) {
      expect(name.length).toBeLessThanOrEqual(NAME_MAX_CHARS);
    }
  });
});

describe('saying who you are out loud', () => {
  it('TC-10 refuses the three ways a name can be nothing', () => {
    for (const raw of ['', '   ', 'x'.repeat(NAME_MAX_CHARS + 1)]) {
      const check = validateName(raw);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toBe(NAME_ERROR);
    }
  });

  it('TC-10 accepts a single character and a full-length name', () => {
    expect(validateName('A')).toEqual({ ok: true, name: 'A' });
    expect(validateName('x'.repeat(NAME_MAX_CHARS))).toEqual({
      ok: true,
      name: 'x'.repeat(NAME_MAX_CHARS),
    });
  });

  it('TC-10 trims rather than refusing', () => {
    // ` Alex ` is a person who typed their name; the spaces are not a reason to
    // say no, and keeping them would leave a label that does not match its
    // tooltip by a space at each end.
    expect(validateName(' Alex ')).toEqual({ ok: true, name: 'Alex' });
  });
});

describe('remembering who you are', () => {
  it('TC-11 keeps a stored identity exactly as it was', () => {
    const store = storeOf({
      [KEY]: JSON.stringify({ id: 'g_stored', name: 'Alex', color: '#3949AB' }),
    });
    expect(loadIdentity(store)).toEqual({ id: 'g_stored', name: 'Alex', color: '#3949AB' });
    // Nothing to write: a board I have already been given an identity on should
    // not rewrite it every single time I look at it.
    expect(store.written).toEqual([]);
  });

  it('TC-11 makes a working identity when storage is a brick wall', () => {
    const identity = loadIdentity(brokenStore());
    expect(identity.id.startsWith('g_')).toBe(true);
    expect(identity.name.split(' ')).toHaveLength(2);
    expect(PRESENCE_COLORS).toContain(identity.color);
    // Private mode is not a reason to have nobody on the board: the identity is
    // held for this visit even though the next one starts over.
  });

  it('TC-11 starts again from garbage under its own key', () => {
    for (const raw of ['not json', '[]', '{"name":1}', '{"name":"","color":"#fff"}']) {
      const identity = loadIdentity(storeOf({ [KEY]: raw }));
      expect(identity.name).not.toBe('');
      expect(identity.id.startsWith('g_')).toBe(true);
    }
  });

  it('writes the identity it made, and reads back a rename', () => {
    const store = storeOf();
    const first = readIdentity(store);
    expect(store.written).toHaveLength(1);

    const reloaded = readIdentity(store);
    expect(reloaded).toEqual(first);

    // A rename that reached storage is the same person on the next page load,
    // which is the whole point of `presence.names`.
    writeIdentity(store, { ...first, name: 'Alex' });
    expect(readIdentity(store)).toEqual({ ...first, name: 'Alex' });
  });

  it('does not hand two tabs the same colour when it can help it', () => {
    // Two windows of one browser share one store, so the second one has to look
    // at what the first is already wearing.
    const store = storeOf();
    const first = readIdentity(store);
    const second = readIdentity(store, {
      names: [first.name],
      colors: [first.color],
    });
    expect(second.color).not.toBe(first.color);
    expect(second.name).not.toBe(first.name);
  });

  it('gives an identity an id that is not the name', () => {
    const id = randomIdentityId();
    expect(id.startsWith('g_')).toBe(true);
    expect(id.length).toBeGreaterThan(20);
    expect(new Set(Array.from({ length: 200 }, () => randomIdentityId())).size).toBe(200);
  });
});
