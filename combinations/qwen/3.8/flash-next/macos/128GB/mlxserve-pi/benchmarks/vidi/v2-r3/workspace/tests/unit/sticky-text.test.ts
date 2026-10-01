// sticky.text unit tests (TC-13 … TC-17): the pure text logic of the note
// editor — minimal Y.Text diffing, the length limit and the counter rule —
// against a real Y.Doc.
import { describe, expect, it } from 'vitest';
import { Doc, Text as YText } from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_NOTE_1000, PASTE_1200, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';

const ORIGIN = Symbol('test.origin');

/** A doc whose "text" Y.Text starts with `initial`, plus recorded deltas. */
function fixture(initial: string): {
  doc: Doc;
  text: YText;
  deltas: unknown[][];
  updates: () => number;
} {
  const doc = new Doc();
  const text = doc.getText('text');
  if (initial !== '') doc.transact(() => text.insert(0, initial));
  const deltas: unknown[][] = [];
  text.observe((event) => deltas.push(event.delta));
  let updates = 0;
  doc.on('update', () => updates++);
  return { doc, text, deltas, updates: () => updates };
}

describe('fixtures are realistic', () => {
  it('has the lengths the boundary tests rely on', () => {
    expect(SHORT_NOTE).toBe('Faster onboarding');
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(100);
    expect(LONG_NOTE_1000).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(PASTE_1200).toHaveLength(1200);
    expect(LONG_NOTE_1000).toMatch(/[a-z]{3,} [a-z]{3,}/); // prose, not single chars
  });
});

describe('applyTextDiff', () => {
  // TC-13: typing one character in the middle is ONE insert, not a rewrite.
  it('TC-13 turns "abc" -> "abXc" into a single insert of "X" at index 2', () => {
    const f = fixture('abc');
    applyTextDiff(f.text, 'abXc', ORIGIN);
    expect(f.text.toString()).toBe('abXc');
    expect(f.deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(f.updates()).toBe(1); // exactly one transaction per input event
  });

  it('deletes only the removed run in the middle', () => {
    const f = fixture('abcde');
    applyTextDiff(f.text, 'acde', ORIGIN);
    expect(f.text.toString()).toBe('acde');
    expect(f.deltas).toEqual([[{ retain: 1 }, { delete: 1 }]]);
  });

  it('replaces a selection with one delete plus one insert', () => {
    const f = fixture('abc');
    applyTextDiff(f.text, 'aXc', ORIGIN);
    expect(f.text.toString()).toBe('aXc');
    expect(f.deltas).toEqual([[{ retain: 1 }, { delete: 1 }, { insert: 'X' }]]);
  });

  it('appends at the end and prepends at the start minimally', () => {
    const f = fixture('abc');
    applyTextDiff(f.text, 'abcd', ORIGIN);
    expect(f.deltas.at(-1)).toEqual([{ retain: 3 }, { insert: 'd' }]);

    const g = fixture('bc');
    applyTextDiff(g.text, 'abc', ORIGIN);
    expect(g.deltas.at(-1)).toEqual([{ insert: 'a' }]);
    expect(g.text.toString()).toBe('abc');
  });

  it('writes nothing when the text did not change', () => {
    const f = fixture('abc');
    applyTextDiff(f.text, 'abc', ORIGIN);
    expect(f.deltas).toEqual([]);
    expect(f.updates()).toBe(0);
  });

  it('keeps multi-line text and surrogate pairs intact', () => {
    const f = fixture(RETRO_ITEM);
    applyTextDiff(f.text, `${RETRO_ITEM}\nship earlier`, ORIGIN);
    expect(f.text.toString()).toBe(`${RETRO_ITEM}\nship earlier`);
    expect(f.deltas.at(-1)).toEqual([{ retain: RETRO_ITEM.length }, { insert: '\nship earlier' }]);

    // An emoji inserted in the middle arrives as one whole code point.
    const g = fixture('ab');
    applyTextDiff(g.text, 'a\u{1F389}b', ORIGIN);
    expect(g.text.toString()).toBe('a\u{1F389}b');
    expect(g.deltas).toEqual([[{ retain: 1 }, { insert: '\u{1F389}' }]]);

    // Replacing the character before a pair must not split the pair in half.
    const h = fixture('\u{1F389}b');
    applyTextDiff(h.text, 'ab', ORIGIN);
    expect(h.text.toString()).toBe('ab');
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(h.text.toString())).toBe(false);

    // Deleting one code point of a pair removes the whole pair, never half.
    const i = fixture('a\u{1F389}b');
    applyTextDiff(i.text, 'a\u{1F389}c', ORIGIN);
    expect(i.text.toString()).toBe('a\u{1F389}c');
  });

  it('runs in the given transaction origin', () => {
    const f = fixture('abc');
    const origins: unknown[] = [];
    f.doc.on('update', (_u: unknown, origin: unknown) => origins.push(origin));
    applyTextDiff(f.text, 'abcd', ORIGIN);
    applyTextDiff(f.text, 'abcde', ORIGIN);
    expect(origins).toEqual([ORIGIN, ORIGIN]);
  });

  // TC-13 requirement in story terms: a concurrent other-user insert (story 3)
  // must survive, which only a minimal diff guarantees.
  it('leaves another client’s characters alone around a local edit', () => {
    const f = fixture('onboarding tips');
    // Local user prepends "fast ": a pure insert, no delete operations.
    applyTextDiff(f.text, 'fast onboarding tips', ORIGIN);
    expect(f.deltas.at(-1)).toEqual([{ insert: 'fast ' }]);
    // A remote client inserts in the middle of the same Y.Text.
    f.text.insert(15, ' great');
    expect(f.text.toString()).toBe('fast onboarding great tips');
    // The next local edit still finds only its own minimal change.
    applyTextDiff(f.text, 'fast onboarding great tips now', ORIGIN);
    expect(f.deltas.at(-1)).toEqual([{ retain: 26 }, { insert: ' now' }]);
    expect(f.text.toString()).toBe('fast onboarding great tips now');
  });
});

describe('clampToLimit', () => {
  // TC-14: a 1,200 character paste keeps exactly the first 1,000.
  it('TC-14 keeps the first 1,000 characters of a 1,200 character paste', () => {
    expect(clampToLimit('')).toBe('');
    const clamped = clampToLimit(PASTE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PASTE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15: the boundary — 999 + 1 is accepted.
  it('TC-15 accepts the 1,000th character', () => {
    const at999 = LONG_NOTE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    const result = clampToLimit(at999 + LONG_NOTE_1000[STICKY_TEXT_MAX_CHARS - 1]);
    expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(LONG_NOTE_1000);
  });

  // TC-16 (negative/boundary): 1,000 + 1 adds nothing.
  it('TC-16 drops everything past the 1,000th character', () => {
    expect(clampToLimit(`${LONG_NOTE_1000}x`)).toBe(LONG_NOTE_1000);
    expect(clampToLimit(`${LONG_NOTE_1000}${'more text'}`)).toBe(LONG_NOTE_1000);
    expect(clampToLimit(LONG_NOTE_1000)).toBe(LONG_NOTE_1000);
  });

  it('applies the limit to the document, not just to the string', () => {
    const f = fixture('');
    applyTextDiff(f.text, clampToLimit(PASTE_1200), ORIGIN);
    expect(f.text.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('honours an explicit maximum', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 3)).toBe('ab');
  });
});

describe('counterVisible', () => {
  // TC-17: the counter appears at 50 remaining characters and earlier.
  it('TC-17 shows at 950, 951 and 1,000 characters but not at 949', () => {
    const threshold = STICKY_COUNTER_THRESHOLD_CHARS;
    expect(STICKY_TEXT_MAX_CHARS - threshold).toBe(950);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('stays hidden for short notes and an empty note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(1)).toBe(false);
  });
});
