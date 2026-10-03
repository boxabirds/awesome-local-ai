/**
 * sticky.text unit tests (TC-13 to TC-17): the pure parts of note text editing
 * - the minimal Y.Text diff, the 1,000 character limit, the counter threshold and
 * where the caret belongs when somebody else's text arrives. Font fitting needs
 * real text layout, so it is covered in e2e.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  shiftCaret,
} from '../../src/client/objects/StickyText';
import {
  PROSE_LIMIT,
  PROSE_OVER_LIMIT,
  PROSE_PASTE,
  RETRO_NOTE,
  SHORT_NOTE,
} from '../fixtures/texts';

/** An operation of a `Y.Text` delta: `{retain}`, `{insert}` or `{delete}`. */
type DeltaOp = { retain?: number; insert?: string; delete?: number };

/** Record the deltas a `Y.Text` produces, so we can see the shape of an edit. */
function deltasOf(ytext: Y.Text): () => DeltaOp[][] {
  const seen: DeltaOp[][] = [];
  ytext.observe((event) => {
    seen.push(event.delta as unknown as DeltaOp[]);
  });
  return () => seen;
}

/** True when a UTF-16 half is not part of a complete pair. */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function makeText(value = ''): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (value) ytext.insert(0, value);
  return ytext;
}

describe('sticky.text clampToLimit', () => {
  // TC-14
  it('TC-14 keeps exactly the first 1,000 characters of a 1,200 character paste', () => {
    expect(PROSE_PASTE.length).toBeGreaterThan(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(PROSE_PASTE);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_PASTE.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  // TC-15
  it('TC-15 accepts the 1,000th character', () => {
    const atBoundary = PROSE_LIMIT.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(atBoundary.length).toBe(999);
    expect(clampToLimit(`${atBoundary}!`)).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  // TC-16 (negative)
  it('TC-16 refuses the 1,001st character', () => {
    expect(PROSE_OVER_LIMIT.length).toBe(STICKY_TEXT_MAX_CHARS + 1);
    expect(clampToLimit(PROSE_OVER_LIMIT)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(PROSE_LIMIT)).toBe(PROSE_LIMIT);
  });

  it('leaves short text and empty text untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit(RETRO_NOTE)).toBe(RETRO_NOTE);
  });

  it('honours an explicit maximum', () => {
    expect(clampToLimit('Faster onboarding', 6)).toBe('Faster');
  });
});

describe('sticky.text applyTextDiff', () => {
  // TC-13
  it('TC-13 writes a single insert in the middle instead of replacing everything', () => {
    const ytext = makeText('abc');
    const seen = deltasOf(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    expect(seen()).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('writes a single delete for a deletion in the middle', () => {
    const ytext = makeText('Faster onboarding');
    const seen = deltasOf(ytext);

    applyTextDiff(ytext, 'Faster onding', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('Faster onding');
    expect(seen()).toEqual([[{ retain: 9 }, { delete: 4 }]]);
  });

  it('writes one delete and one insert when a selection is replaced', () => {
    const ytext = makeText('the quick board');
    const seen = deltasOf(ytext);

    applyTextDiff(ytext, 'the calm board', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('the calm board');
    expect(seen()).toHaveLength(1);
    const [delta] = seen();
    expect(delta).toBeDefined();
    expect(delta!.some((op) => 'delete' in op)).toBe(true);
    expect(delta!.some((op) => 'insert' in op)).toBe(true);
    // The unchanged prefix is retained, never rewritten; Yjs trims the
    // trailing retain of the untouched suffix, so nothing follows the insert.
    expect(delta).toEqual([{ retain: 4 }, { delete: 5 }, { insert: 'calm' }]);
  });

  it('appends and prepends with one insert each', () => {
    const appended = makeText('note');
    const seenAppended = deltasOf(appended);
    applyTextDiff(appended, 'note one', LOCAL_ORIGIN);
    expect(seenAppended()).toEqual([[{ retain: 4 }, { insert: ' one' }]]);

    const prepended = makeText('note');
    const seenPrepended = deltasOf(prepended);
    applyTextDiff(prepended, 'my note', LOCAL_ORIGIN);
    expect(seenPrepended()).toEqual([[{ insert: 'my ' }]]);
  });

  it('writes nothing when the text has not changed', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, SHORT_NOTE);
    const seen = deltasOf(ytext);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(ytext, SHORT_NOTE, LOCAL_ORIGIN);

    expect(seen()).toEqual([]);
    expect(updates).toBe(0);
    expect(ytext.toString()).toBe(SHORT_NOTE);
  });

  it('replaces everything when there is nothing in common', () => {
    const ytext = makeText('xyz');
    const seen = deltasOf(ytext);

    applyTextDiff(ytext, 'cat', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('cat');
    expect(seen()).toEqual([[{ delete: 3 }, { insert: 'cat' }]]);
  });

  it('clears the note when the text becomes empty', () => {
    const ytext = makeText(SHORT_NOTE);
    const seen = deltasOf(ytext);

    applyTextDiff(ytext, '', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('');
    expect(seen()).toEqual([[{ delete: SHORT_NOTE.length }]]);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const ytext = makeText('ship 🚀 it');
    const seen = deltasOf(ytext);

    // Deleting the word before the emoji must not split the pair in half.
    applyTextDiff(ytext, 'it', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('it');
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    expect(seen()).toEqual([[{ delete: 8 }]]);

    applyTextDiff(ytext, 'ship 🚀🎉 it', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('ship 🚀🎉 it');
  });

  it('handles a replacement that shares both edges of a surrogate pair', () => {
    const ytext = makeText('a😀b');
    applyTextDiff(ytext, 'a😃b', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a😃b');
  });

  it('writes one transaction carrying the given origin', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('note');
    ytext.insert(0, 'abc');
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});

describe('sticky.text counterVisible', () => {
  // TC-17
  it('TC-17 appears at the threshold and stays visible to the limit', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false); // 949
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1)).toBe(true); // 951
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('stays hidden for short notes', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(500)).toBe(false);
  });
});

describe('sticky.text shiftCaret', () => {
  // Story 3: text arriving in a note that is open for editing (TC-23, TC-24).
  it('leaves a caret before the arriving text where it is', () => {
    expect(shiftCaret(2, 'green', 'green now')).toBe(2);
    expect(shiftCaret(0, 'green', 'green now')).toBe(0);
  });

  it('moves a caret after the arriving text by as much as that text is worth', () => {
    expect(shiftCaret(5, 'green', 'you green')).toBe(9);
    expect(shiftCaret(7, '!!green', 'green')).toBe(5);
    // A change that happens after the caret leaves it alone, even when it deletes.
    expect(shiftCaret(5, 'green!!', 'green')).toBe(5);
  });

  it('never puts the caret before the start of the change', () => {
    // 'abc' became 'xyz': a caret in the middle of what was replaced ends up in
    // what replaced it, not behind it.
    expect(shiftCaret(1, 'abc', 'xyz')).toBeGreaterThanOrEqual(1);
    expect(shiftCaret(1, 'abcd', 'ad')).toBe(1);
  });

  it('keeps the caret where it is when nothing changed', () => {
    expect(shiftCaret(3, 'green', 'green')).toBe(3);
  });

  it('keeps a whole character either side of an emoji', () => {
    // The caret sits after the surrogate pair; text arrives in front of it.
    const caret = 'a👍'.length;
    expect(shiftCaret(caret, 'a👍', 'b/a👍')).toBe(caret + 2);
  });
});
