// sticky.text unit tests (TC-13 … TC-17): the pure text logic of the note
// editor — minimal Y.Text diffing, the length limit and the counter rule —
// against a real Y.Doc.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Doc, Text as YText } from 'yjs';
import { applyTextDelta, applyTextDiff, clampToLimit, counterVisible, diffText } from '../../src/client/objects/StickyText';
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

// Story 3 adds the second half of two people typing into one note: the change
// that goes out is measured against the text this document last agreed with the
// room, not against the shared text as it happens to look. `diffText` and
// `applyTextDelta` are that measurement, and they are where a lost character
// would be lost.
describe('diffText (story 3: the local edit, measured against the agreed text)', () => {
  it('reports one keystroke at the end as an insertion at the end', () => {
    expect(diffText('green', 'green blue')).toEqual({ start: 5, baseEnd: 5, insert: ' blue' });
  });

  it('reports one keystroke at the start as an insertion at the start', () => {
    expect(diffText('green', 'red green')).toEqual({ start: 0, baseEnd: 0, insert: 'red ' });
  });

  it('reports a backspace as a deletion of the one character it removed', () => {
    // Not "make the text look like this": a replacement would carry the whole
    // tail with it, and the tail is where somebody else's typing is.
    expect(diffText('green blue', 'green blu')).toEqual({ start: 9, baseEnd: 10, insert: '' });
  });

  it('reports the whole text as the change when nothing is shared', () => {
    expect(diffText('dog', 'cat')).toEqual({ start: 0, baseEnd: 3, insert: 'cat' });
  });

  it('reports a middle change by its longest shared edges', () => {
    // "gryen" -> "green": the shared prefix is "gr", the shared suffix "en", so
    // what is reported is the one character that is not shared.
    expect(diffText('gryen', 'green')).toEqual({ start: 2, baseEnd: 3, insert: 'e' });
  });

  it('reports no change as no change', () => {
    expect(diffText('green', 'green')).toEqual({ start: 5, baseEnd: 5, insert: '' });
    expect(diffText('', '')).toEqual({ start: 0, baseEnd: 0, insert: '' });
  });

  it('never cuts a surrogate pair in half, because it counts whole characters', () => {
    // An emoji is one character to a person and two code units to a string; a
    // diff that stepped by code units could put one of them on the wrong side.
    const withEmoji = 'ship \u{1F6A2}!';
    const { insert } = diffText('ship ', withEmoji);
    expect(insert).toBe('\u{1F6A2}!');
    expect(insert.split('\u{1F6A2}')).toHaveLength(2);
  });
});

describe('applyTextDelta (story 3: two people, one text)', () => {
  /**
   * Two documents that behave like two browsers on one board, with the network
   * under the test's control: writes are queued and delivered on demand, so a
   * test can have both people write before either has seen the other's change —
   * which is the only situation where "simultaneous" means what it says.
   */
  function pair(initial: string): {
    a: Doc;
    b: Doc;
    textA: YText;
    textB: YText;
    connect(): void;
    deliver(): void;
  } {
    const a = new Doc();
    const b = new Doc();
    if (initial !== '') a.transact(() => a.getText('text').insert(0, initial));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const relay = Symbol('relay');
    const pending: { target: Doc; update: Uint8Array }[] = [];
    a.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== relay) pending.push({ target: b, update });
    });
    b.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== relay) pending.push({ target: a, update });
    });
    return {
      a,
      b,
      textA: a.getText('text'),
      textB: b.getText('text'),
      // A connection that is already established: from here on, a write goes
      // straight across.
      connect() {
        a.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin !== relay) Y.applyUpdate(b, update, relay);
        });
        b.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin !== relay) Y.applyUpdate(a, update, relay);
        });
      },
      deliver() {
        for (const hop of pending.splice(0, pending.length)) Y.applyUpdate(hop.target, hop.update, relay);
      },
    };
  }

  it('keeps both people’s characters when each types at a different end', () => {
    const { a, b, textA, textB, deliver } = pair('green');
    // Both started from "green" and neither has seen the other yet: A adds a
    // word in front, B adds one on the end.
    applyTextDelta(textA, 'green', 'red green', ORIGIN);
    applyTextDelta(textB, 'green', 'green blue', ORIGIN);
    deliver();

    // Every character of both, in the one order both sides agree on.
    expect(textA.toString()).toBe('red green blue');
    expect(textB.toString()).toBe('red green blue');
    void a;
    void b;
  });

  it('keeps the other person’s characters when this side only deletes one', () => {
    const { a, b, textA, textB, connect } = pair('green');
    connect();
    // B types at the end, and the change arrives in A's document.
    applyTextDelta(textB, 'green', 'green blue', ORIGIN);
    expect(textA.toString()).toBe('green blue');

    // A's textarea never caught up: it still shows "green". A backspaces, which
    // deletes A's own last character — not B's word. This is the one test of
    // what the fix is for: with the diff taken against the shared text as it
    // looks now, "green" against "green blue" reads as a request to delete
    // " blue", and B loses everything they typed.
    applyTextDelta(textA, 'green', 'gree', ORIGIN);

    expect(textA.toString()).toBe('gree blue');
    expect(textB.toString()).toBe('gree blue');
    void a;
    void b;
  });

  it('applies one edit as one transaction with the given origin', () => {
    const doc = new Doc();
    const text = doc.getText('text');
    doc.transact(() => text.insert(0, 'green'));
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    applyTextDelta(text, 'green', 'green!', ORIGIN);
    expect(origins).toEqual([ORIGIN]);
    expect(text.toString()).toBe('green!');
  });

  it('clamps instead of throwing when the shared text has shrunk under the edit', () => {
    // The base says five characters; the note's text has been emptied since, so
    // there is nothing at offset 5 to insert after. The edit is still made —
    // there is no exception, and nothing is lost that could be put back.
    const doc = new Doc();
    const text = doc.getText('text');
    expect(() => applyTextDelta(text, 'green', 'green!', ORIGIN)).not.toThrow();
    expect(text.toString()).toBe('!');
  });

  it('deletes only what it means to when the shared text has grown past the range', () => {
    // The base ends at 5; the text has grown to 10 characters in the meantime.
    // Deleting back one character from the base deletes one character, not the
    // whole tail — which is the difference between this and "make the text look
    // like the textarea".
    const doc = new Doc();
    const text = doc.getText('text');
    doc.transact(() => text.insert(0, 'green blue'));
    applyTextDelta(text, 'green', 'gree', ORIGIN);
    expect(text.toString()).toBe('gree blue');
  });

  it('puts a whole pasted run in one place, in one transaction', () => {
    const { a, textA } = pair('green');
    const origins: unknown[] = [];
    a.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    applyTextDelta(textA, 'green', `green ${RETRO_ITEM}`, ORIGIN);
    expect(origins).toHaveLength(1);
    expect(textA.toString()).toBe(`green ${RETRO_ITEM}`);
  });

  it('is the same text on both sides after ten exchanges each', () => {
    const { a, b, textA, textB, connect } = pair('start');
    connect();
    // Each side keeps its own base, as the editor does: the text it last agreed,
    // which by now is the text it has.
    let baseA = textA.toString();
    let baseB = textB.toString();
    for (let index = 0; index < 10; index++) {
      applyTextDelta(textA, baseA, `${textA.toString()}a${index}`, ORIGIN);
      applyTextDelta(textB, baseB, `${index}b${textB.toString()}`, ORIGIN);
      baseA = textA.toString();
      baseB = textB.toString();
    }
    const both = textA.toString();
    expect(both).toBe(textB.toString());
    for (let index = 0; index < 10; index++) {
      expect(both).toContain(`a${index}`);
      expect(both).toContain(`${index}b`);
    }
    void a;
    void b;
  });
});
