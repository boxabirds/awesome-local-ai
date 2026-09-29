import { IDENTITY_STORAGE_KEY, NAME_MAX_CHARS, PRESENCE_COLORS } from '../../shared/config';

/**
 * Who this browser is on a board (story 6, task 10).
 *
 * A person arrives as somebody, not as `Anonymous Duck`: a name they may
 * change, a colour that says which arrow and which label on the stack is
 * theirs, and an id that says which *person* a second tab belongs to. All
 * three are made here and remembered in one place, because a board that
 * renames you every reload, repaints you every frame, or counts your two
 * windows as two people does not know you.
 *
 * ## Why the name is two words
 *
 * "Otter" alone repeats as soon as nine people arrive, and a name that repeats
 * cannot be the thing that tells people apart. Adjective plus animal gives a
 * few hundred combinations from sixty words, which is more than enough for a
 * board whose capacity is five, and it reads like a person rather than like a
 * session id.
 *
 * ## Why the id exists separately from the name
 *
 * The name is what other people call you and can therefore be the same as
 * somebody else's; the id is what says two arrows belong to one person. It is
 * per browser, not per tab, which is what makes "the same board open in two
 * windows" one avatar instead of two.
 */

/** One person's badge. */
export interface Identity {
  /** Whose browser this is: stable across tabs and reloads of one profile. */
  id: string;
  name: string;
  color: string;
}

/**
 * The names offered to somebody who has not chosen one.
 *
 * Adjective-and-animal pairs, long before the story's example of "Curious
 * Otter". At least `MAX_CONCURRENT_EDITORS` long with no duplicates inside it,
 * for the same reason the colour palette is: with fewer than eight usable names
 * a full board would have to repeat one. They are also what `distinguish` falls
 * back to when five people arrive wearing the same name, so the list is
 * deliberately longer than the capacity.
 */
export const GUEST_NAMES = [
  'Curious Otter',
  'Brave Heron',
  'Quiet Falcon',
  'Clever Octopus',
  'Swift Mustang',
  'Gentle Bison',
  'Bold Pangolin',
  'Calm Lemur',
  'Witty Raven',
  'Lucky Condor',
  'Nimble Marten',
  'Wise Tortoise',
  'Jolly Walrus',
  'Keen Shrike',
  'Merry Badger',
  'Proud Ibis',
  'Silent Lynx',
  'Noble Egret',
  'Amber Jackal',
  'Copper Vole',
  'Dusty Marlin',
  'Frosty Marmot',
  'Golden Oriole',
  'Hollow Toad',
  'Iron Salamander',
  'Jade Cormorant',
  'Misty Antelope',
  'Ocean Petrel',
  'Pearl Gannet',
  'Quartz Oryx',
  'Silver Impala',
  'Solar Termite',
  'Tawny Osprey',
  'Umber Caribou',
  'Velvet Grouse',
  'Winter Eel',
  'Amber Shag',
  'Basalt Lemming',
  'Bright Serval',
  'Candid Myna',
  'Daring Plover',
  'Eager Shelduck',
] as const;

/**
 * What a person gets when every name is taken.
 *
 * A seventh person cannot be told they are out of names: the name still has to
 * tell the other four who they are looking at, so the pool is widened with a
 * numbered `Curious Otter 2` rather than reused.
 */
export const NAME_FALLBACK = 'Guest';

/**
 * What a person gets when every colour is taken.
 *
 * Neutral slate, deliberately outside the palette: the rule is that a full
 * board shows different colours, and running out is answered by becoming
 * distinguishable, not by copying somebody.
 */
export const COLOR_FALLBACK = '#607D8B';

/** Longest name accepted, and what a longer one is cut to (≤ 40 shown). */
export function displayName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= NAME_MAX_CHARS ? trimmed : trimmed.slice(0, NAME_MAX_CHARS);
}

/**
 * A name for somebody who has never been here before.
 *
 * `rng` is a parameter rather than `Math.random` so a test can replay a
 * failure, and so a board can be shown to hand five people five different
 * names without waiting for chance.
 */
export function randomGuestName(rng: () => number = Math.random): string {
  const pick = GUEST_NAMES[Math.floor(rng() * GUEST_NAMES.length) % GUEST_NAMES.length];
  return pick ?? GUEST_NAMES[0]!;
}

/** A stable id for this browser, or as near to one as a browser without crypto allows. */
export function randomIdentityId(rng: () => number = Math.random): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(rng() * 256);
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `g_${hex}`;
}

/**
 * Is this a name somebody is allowed to be called?
 *
 * Empty, all spaces and over-length are all the same answer, which is the
 * answer the design gives: "Name must be 1–32 characters". Anything else is
 * returned trimmed, so ` Alex ` becomes a name rather than a name with padding
 * that no longer matches its own tooltip.
 */
export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** The message the design asks for, in one place so the field and the tests agree. */
export const NAME_ERROR = 'Name must be 1–32 characters';

export function validateName(raw: string): NameCheck {
  const name = raw.trim();
  if (name.length < 1 || name.length > NAME_MAX_CHARS) return { ok: false, error: NAME_ERROR };
  return { ok: true, name };
}

/**
 * The first colour in the palette nobody is wearing.
 *
 * `taken` is what the other people already on the board wear, which is exactly
 * what the board reports and therefore exactly what a second tab opening the
 * same board can see. When the palette is exhausted the answer is the neutral
 * fallback, and only if even that is somehow taken does it return `null`: a
 * caller that gets `null` has more people on it than colours exist, and drawing
 * them any other way would be a lie about who is who.
 */
export function pickColour(taken: readonly string[]): string | null {
  for (const color of PRESENCE_COLORS) {
    if (!taken.includes(color)) return color;
  }
  return taken.includes(COLOR_FALLBACK) ? null : COLOR_FALLBACK;
}

/**
 * The first guest name nobody else is answering to.
 *
 * Same shape as the colour rule, with one addition: names have a *memory*. A
 * browser that was `Curious Otter` a moment ago stays `Curious Otter` even if
 * somebody else took it, because a name is only useful if it keeps pointing at
 * the same person; the suffix is what keeps two browsers wearing one name from
 * being indistinguishable.
 */
export function pickGuestName(taken: readonly string[]): string | null {
  for (const name of GUEST_NAMES) {
    if (!taken.includes(name)) return name;
  }
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    for (const name of GUEST_NAMES) {
      const candidate = `${name} ${suffix}`;
      if (!taken.includes(candidate)) return candidate;
    }
  }
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const candidate = `${NAME_FALLBACK} ${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return null;
}

/** The little bit of storage this needs, so the tests can hand in a `Map`. */
export interface IdentityStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * This browser's identity, made on first use and kept after that.
 *
 * `storage` is a parameter rather than a read of `globalThis.localStorage` so
 * the rule can be tested without a browser, and so a private-mode tab where
 * `setItem` throws still gets a working identity: the storage is a memory, not
 * a requirement.
 */
export function readIdentity(
  store: IdentityStore | null,
  taken: { names: readonly string[]; colors: readonly string[] } = { names: [], colors: [] },
  rng: () => number = Math.random,
): Identity {
  const stored = readStored(store);
  if (stored !== null && taken.names.includes(stored.name) === false) return stored;
  const name = pickGuestName(taken.names) ?? NAME_FALLBACK;
  const color = pickColour(taken.colors) ?? COLOR_FALLBACK;
  // Somebody who had an identity before keeps their id even when their name and
  // colour have to change: the id is what says this window is the same person
  // that arrived earlier, and dropping it would split one person into two dots.
  const identity = { id: stored?.id ?? randomIdentityId(rng), name, color };
  writeIdentity(store, identity);
  return identity;
}

/** Remember this browser's identity, if remembering is possible at all. */
export function writeIdentity(store: IdentityStore | null, identity: Identity): void {
  if (store === null) return;
  try {
    store.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private mode, a full quota, an entitlement we do not have. The identity
    // still works for this visit, which is the whole point of it.
  }
}

function readStored(store: IdentityStore | null): Identity | null {
  if (store === null) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(IDENTITY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (typeof parsed?.name !== 'string' || typeof parsed?.color !== 'string') return null;
    const name = displayName(parsed.name);
    if (name === '') return null;
    const id = typeof parsed.id === 'string' && parsed.id.startsWith('g_') ? parsed.id : '';
    return { id: id === '' ? randomIdentityId() : id, name, color: parsed.color };
  } catch {
    // Somebody else's bytes under our key. A fresh identity beats a broken one.
    return null;
  }
}
