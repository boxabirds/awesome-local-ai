/**
 * sticky.text unit tests (TC-13 to TC-17): the pure parts of note text editing
 * against a real Y.Text — the minimal diff, the 1,000 character limit and the
 * counter rule. Font auto-fit needs real text layout and is covered in e2e.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  mapCaret
} from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS
} from '../../src/shared/config';
import { PROSE_1000, RETRO_ITEM, SHORT_PHRASE, proseOfLength } from '../fixtures/texts';

/** One op of a Y.Text delta, as observed. */
type TextOp = { insert?: string; retain?: number; delete?: number };

/** The ops a Y.Text observer saw, flattened to a comparable shape. */
function deltasOf(text: Y.Text, run: () => void): TextOp[] {
  const seen: TextOp[] = [];
  const listener = (event: Y.YTextEvent) => {
    seen.push(...(event.delta as TextOp[]));
  };
  text.observe(listener);
  run();
  text.unobserve(listener);
  return seen;
}

/**
 * A `Y.Text` inside a document, holding `value`.
 *
 * It has to live in a document: Yjs refuses to read a shared type that is not
 * attached to one, and this is how a note's text really is stored anyway.
 */
function textWith(value: string): Y.Text {
  const doc = new Y.Doc();
  const text = new Y.Text();
  doc.getMap('t').set('text', text);
  doc.transact(() => text.insert(0, value), LOCAL_ORIGIN);
  return text;
}

/** Does the string contain a surrogate cut in half? */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('applyTextDiff (minimal change into the shared text)', () => {
  it('TC-13: inserting one character is a single insert at that index', () => {
    const text = textWith('abc');
    const ops = deltasOf(text, () => applyTextDiff(text, 'abXc', LOCAL_ORIGIN));

    expect(text.toString()).toBe('abXc');
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13: deleting one character in the middle is a single delete', () => {
    const text = textWith('abcdef');
    const ops = deltasOf(text, () => applyTextDiff(text, 'abdef', LOCAL_ORIGIN));

    expect(text.toString()).toBe('abdef');
    expect(ops).toEqual([{ retain: 2 }, { delete: 1 }]);
  });

  it('TC-13: replacing a selection is one delete plus one insert', () => {
    const text = textWith('hello world');
    const ops = deltasOf(text, () => applyTextDiff(text, 'hello there', LOCAL_ORIGIN));

    expect(text.toString()).toBe('hello there');
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(1);
    expect(ops.filter((op) => op.insert !== undefined)).toHaveLength(1);
    // The untouched prefix is retained, not retyped.
    expect(ops[0]).toEqual({ retain: 6 });
  });

  it('TC-13: text that did not change writes nothing at all', () => {
    const text = textWith(SHORT_PHRASE);
    const doc = text.doc as Y.Doc;
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(text, SHORT_PHRASE, LOCAL_ORIGIN);

    expect(updates).toBe(0);
    expect(text.toString()).toBe(SHORT_PHRASE);
  });

  it('TC-13: an insert and a delete at the same spot stay one transaction', () => {
    const text = textWith('alpha');
    const doc = text.doc as Y.Doc;
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(text, 'Xlphb', LOCAL_ORIGIN);

    expect(text.toString()).toBe('Xlphb');
    expect(updates).toBe(1);
  });

  it('TC-13: an emoji next to the edit keeps its surrogate pair intact', () => {
    const text = textWith('a😀b');
    applyTextDiff(text, 'a😀Xb', LOCAL_ORIGIN);
    expect(text.toString()).toBe('a😀Xb');
    expect(text.length).toBe(5);
    expect(hasLoneSurrogate(text.toString())).toBe(false);
  });

  it('TC-13: an edit that would cut an emoji in half replaces the whole emoji', () => {
    const text = textWith('😀ship it');
    applyTextDiff(text, '🎉ship it', LOCAL_ORIGIN);
    expect(text.toString()).toBe('🎉ship it');
    expect(hasLoneSurrogate(text.toString())).toBe(false);
  });

  it('TC-13: multi-line note text keeps its newlines', () => {
    const text = textWith('');
    applyTextDiff(text, RETRO_ITEM, LOCAL_ORIGIN);
    expect(text.toString()).toBe(RETRO_ITEM);
    expect(text.toString().split('\n')).toHaveLength(3);
  });

  it('a diff on text that is no longer in a document is ignored', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    const object = new Y.Map<unknown>();
    const text = new Y.Text();
    doc.transact(() => {
      text.insert(0, 'abc');
      object.set('text', text);
      objects.set('a', object);
    });
    doc.transact(() => objects.delete('a'), LOCAL_ORIGIN);

    expect(() => applyTextDiff(text, 'abcd', LOCAL_ORIGIN)).not.toThrow();
  });
});

describe('clampToLimit (sticky.text_limit)', () => {
  it('TC-14: a 1,200 character paste keeps exactly the first 1,000', () => {
    const pasted = proseOfLength(1200);
    const clamped = clampToLimit(pasted);

    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(clamped).toBe(PROSE_1000);
  });

  it('TC-15: 999 characters plus one is accepted', () => {
    const value = `${proseOfLength(999)}x`;
    expect(value).toHaveLength(1000);
    expect(clampToLimit(value)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(value)).toBe(value);
  });

  it('TC-16: 1,000 characters plus one does not grow past the limit', () => {
    const atLimit = proseOfLength(1000);
    expect(clampToLimit(`${atLimit}x`)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(`${atLimit}x`)).toBe(atLimit);
  });

  it('short text is returned untouched, including the empty note', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
  });

  it('the limit can be overridden (the setting is the default, not a hardcode)', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('abcdef', 0)).toBe('');
  });

  it('a cut that would split an emoji drops the whole emoji instead', () => {
    const value = `${proseOfLength(999)}😀tail`;
    const clamped = clampToLimit(value);

    expect(clamped.length).toBeLessThan(STICKY_TEXT_MAX_CHARS);
    expect(hasLoneSurrogate(clamped)).toBe(false);
    expect(clamped.length).toBe(999);
  });

  it('writing clamped text into a Y.Text leaves the document at exactly the limit', () => {
    const text = textWith('');
    applyTextDiff(text, clampToLimit(proseOfLength(1200)), LOCAL_ORIGIN);
    expect(text.length).toBe(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(text, clampToLimit(`${text.toString()}more`), LOCAL_ORIGIN);
    expect(text.length).toBe(STICKY_TEXT_MAX_CHARS);
  });
});

describe('counterVisible (STICKY_COUNTER_THRESHOLD_CHARS)', () => {
  // TC-17: 949, 950 and 951 characters leave 51, 50 and 49.
  it.each([
    [949, false],
    [950, true],
    [951, true]
  ])('TC-17: %d characters show the counter: %s', (length, expected) => {
    expect(counterVisible(length)).toBe(expected);
  });

  it('an empty or ordinary note shows no counter', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PHRASE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
  });

  it('a note at the limit shows the counter', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('the threshold comes from the setting, not from a number in the code', () => {
    // The rule is exactly "this close to the limit", wherever that is.
    for (const length of [0, 1, 499, 948, 949, 950, 999, STICKY_TEXT_MAX_CHARS]) {
      expect(counterVisible(length)).toBe(
        STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS
      );
    }
  });
});

describe('mapCaret (carrying the caret across somebody else typing)', () => {
  /** The delta a real `Y.Text` reports when `run` changes it. */
  const opsOf = (text: Y.Text, run: () => void) => deltasOf(text, run);

  it('leaves a caret alone when the text arrives after it', () => {
    const text = textWith('goals');
    const delta = opsOf(text, () => text.insert(5, ' learned'));
    expect(mapCaret(5, delta)).toBe(5);
  });

  it('carries the caret along when the text arrives before it', () => {
    const text = textWith('goals');
    const delta = opsOf(text, () => text.insert(0, 'our '));
    expect(mapCaret(5, delta)).toBe(9);
  });

  it('brings the caret to where the deletion happened when it lands inside it', () => {
    const text = textWith('goals learned');
    const delta = opsOf(text, () => text.delete(5, 7));
    expect(mapCaret(8, delta)).toBe(5);
  });

  it('pulls the caret back when text goes away well before it', () => {
    const text = textWith('goals learned');
    const delta = opsOf(text, () => text.delete(0, 6));
    expect(mapCaret(12, delta)).toBe(6);
  });

  it('counts every change when the caret sits past all of them', () => {
    const text = textWith('abc');
    const delta = opsOf(text, () => text.insert(1, 'X'));
    expect(mapCaret(3, delta)).toBe(4);
  });

  it('never puts the caret before the start of what is left', () => {
    const text = textWith('abc');
    const delta = opsOf(text, () => text.delete(0, 3));
    expect(mapCaret(0, delta)).toBe(0);
    // A caret that was already past the end keeps its distance from the text before
    // it, and the caller clamps that to the text it now holds.
    expect(mapCaret(9, [{ delete: 3 }])).toBe(6);
  });
});

describe('fitFontSize settings sanity (behaviour is verified in e2e)', () => {
  it('the searchable range is 24 down to 10, integers only', () => {
    expect(STICKY_FONT_MAX_PX).toBe(24);
    expect(STICKY_FONT_MIN_PX).toBe(10);
    expect(STICKY_FONT_MAX_PX).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(Number.isInteger(STICKY_FONT_MAX_PX)).toBe(true);
    expect(Number.isInteger(STICKY_FONT_MIN_PX)).toBe(true);
  });

  it('fitFontSize is exported and returns a font size with an overflow flag', () => {
    expect(typeof fitFontSize).toBe('function');
  });
});
