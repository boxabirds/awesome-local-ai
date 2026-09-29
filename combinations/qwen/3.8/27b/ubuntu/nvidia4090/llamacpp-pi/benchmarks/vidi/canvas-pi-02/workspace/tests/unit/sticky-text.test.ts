import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDelta, applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

type DeltaOp = { retain?: number; insert?: string; delete?: number };

function observeDeltas(ytext: Y.Text): DeltaOp[] {
  const deltas: DeltaOp[] = [];
  ytext.observe((ev) => {
    for (const op of ev.delta) {
      const { retain, insert, delete: del } = op as { retain?: unknown; insert?: unknown; delete?: unknown };
      const next: DeltaOp = {};
      if (typeof retain === 'number') next.retain = retain;
      if (typeof insert === 'string') next.insert = insert;
      if (typeof del === 'number') next.delete = del;
      deltas.push(next);
    }
  });
  return deltas;
}

/** A doc-bound Y.Text pre-filled with `initial`. */
function textOf(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText();
  if (initial !== '') ytext.insert(0, initial);
  return ytext;
}

// Realistic English fixtures (never repeated single characters: they lay out
// unrealistically).
const SENTENCES = [
  'The team agreed to shorten the onboarding checklist and move the invite step earlier.',
  'Users who get stuck tend to abandon the flow, so we should show progress and a help link.',
  'We will measure drop-off per step and review the numbers in two weeks.',
  'A clearer error message for failed payments would remove most of the support tickets.',
];

function proseOf(length: number): string {
  let text = '';
  let i = 0;
  while (text.length < length) {
    text += (text === '' ? '' : ' ') + SENTENCES[i % SENTENCES.length];
    i += 1;
  }
  return text.slice(0, length);
}

describe('sticky.text: applyTextDiff (minimal diff, one transaction)', () => {
  it('TC-13 a single character insert is one insert at the right index (not replace-all)', () => {
    const ytext = textOf('abc');
    const deltas = observeDeltas(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    // Exactly one insert of "X" after two retained characters.
    expect(deltas).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('a pure middle deletion is one delete with no insert', () => {
    const ytext = textOf('abcd');
    const deltas = observeDeltas(ytext);

    applyTextDiff(ytext, 'ad', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('ad');
    expect(deltas).toEqual([{ retain: 1 }, { delete: 2 }]);
  });

  it('replacing a selection is one delete plus one insert', () => {
    const ytext = textOf('abcdef');
    const deltas = observeDeltas(ytext);

    applyTextDiff(ytext, 'abXYef', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXYef');
    expect(deltas).toEqual([{ retain: 2 }, { delete: 2 }, { insert: 'XY' }]);
  });

  it('keeps emoji surrogate pairs intact when replacing the emoji', () => {
    const ytext = textOf('a😀b');
    const deltas = observeDeltas(ytext);

    applyTextDiff(ytext, 'a😃b', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('a😃b');
    // The whole pair (2 code units) is replaced by the whole pair.
    expect(deltas).toEqual([{ retain: 1 }, { delete: 2 }, { insert: '😃' }]);
  });

  it('inserting next to an emoji keeps the pair intact', () => {
    const ytext = textOf('ab😀cd');
    const deltas = observeDeltas(ytext);

    applyTextDiff(ytext, 'ab😀Xcd', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('ab😀Xcd');
    expect(deltas).toEqual([{ retain: 4 }, { insert: 'X' }]);
  });

  it('deleting the whole text and typing from empty are single ops', () => {
    const fromEmpty = textOf('');
    const d1 = observeDeltas(fromEmpty);
    applyTextDiff(fromEmpty, 'hi', LOCAL_ORIGIN);
    expect(d1).toEqual([{ insert: 'hi' }]);

    const toEmpty = textOf('😀x');
    const d2 = observeDeltas(toEmpty);
    applyTextDiff(toEmpty, '', LOCAL_ORIGIN);
    expect(d2).toEqual([{ delete: 3 }]);
  });

  it('an unchanged value performs no write at all', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText();
    ytext.insert(0, 'abc');
    const deltas = observeDeltas(ytext);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);

    expect(deltas).toEqual([]);
    expect(updates).toBe(0);
  });
});

describe('sticky.text: applyTextDelta (remote -> local merge, caret-preserving)', () => {
  it('an insert before the caret shifts the caret right', () => {
    // "green", caret at the end (5,5); remote inserts "red " at the start.
    const r = applyTextDelta('green', [{ insert: 'red ' }, { retain: 5 }], 5, 5);
    expect(r.text).toBe('red green');
    expect(r.start).toBe(9);
    expect(r.end).toBe(9);
  });

  it('a COMPACT insert at the start (no explicit trailing retain) keeps an end caret at the end', () => {
    // Yjs emits compact deltas: an insert at the start of "green" is just
    // [{insert:'red '}] — the trailing "green" is implicitly retained, not
    // spelled out. A caret at the end must stay at the (new) end, not collapse
    // to the change point. This was the TC-23 concurrent-typing flake: a wrong
    // end-caret made the next local keystroke insert mid-word and scramble the
    // shared text.
    const r = applyTextDelta('green', [{ insert: 'red ' }], 5, 5);
    expect(r.text).toBe('red green');
    expect(r.start).toBe(9);
    expect(r.end).toBe(9);
  });

  it('a COMPACT delete at the start (no explicit trailing retain) keeps an end caret at the end', () => {
    // Compact: deleting "gr" from "green" is [{delete:2}]; the trailing "een" is
    // implicit. An end caret must land at the new end (3), not 0.
    const r = applyTextDelta('green', [{ delete: 2 }], 5, 5);
    expect(r.text).toBe('een');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });

  it('an insert after the caret leaves the caret alone', () => {
    // "green", caret after "gre" (3,3); remote inserts " blue" at the end.
    const r = applyTextDelta('green', [{ retain: 5 }, { insert: ' blue' }], 3, 3);
    expect(r.text).toBe('green blue');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });

  it('an insert exactly at the caret pushes the caret past it', () => {
    const r = applyTextDelta('abc', [{ retain: 1 }, { insert: 'X' }, { retain: 2 }], 1, 1);
    expect(r.text).toBe('aXbc');
    expect(r.start).toBe(2);
    expect(r.end).toBe(2);
  });

  it('a delete before the caret shifts the caret left', () => {
    // "abcd", caret at 4 (end); remote deletes "ab".
    const r = applyTextDelta('abcd', [{ delete: 2 }, { retain: 2 }], 4, 4);
    expect(r.text).toBe('cd');
    expect(r.start).toBe(2);
    expect(r.end).toBe(2);
  });

  it('a delete that swallows the caret clamps it to the delete start', () => {
    // "abcdef", caret at 3 (inside "bcd"); remote deletes "bcd".
    const r = applyTextDelta('abcdef', [{ retain: 1 }, { delete: 3 }, { retain: 2 }], 3, 3);
    expect(r.text).toBe('aef');
    expect(r.start).toBe(1);
    expect(r.end).toBe(1);
  });

  it('a delete entirely after the caret leaves the caret alone', () => {
    const r = applyTextDelta('abcdef', [{ retain: 2 }, { delete: 3 }, { retain: 1 }], 1, 1);
    expect(r.text).toBe('abf');
    expect(r.start).toBe(1);
    expect(r.end).toBe(1);
  });

  it('a pure retain is a no-op on text and caret', () => {
    const r = applyTextDelta('hello', [{ retain: 5 }], 2, 4);
    expect(r.text).toBe('hello');
    expect(r.start).toBe(2);
    expect(r.end).toBe(4);
  });

  it('a whole-text replace ends with the replacement selected', () => {
    // "seed", whole-text selection (0,4); remote deletes it and inserts "a" at
    // the same point. The caret at the delete's end is pushed past the insert,
    // so the new selection (0,1) selects the replacement "a".
    const r = applyTextDelta('seed', [{ delete: 4 }, { insert: 'a' }], 0, 4);
    expect(r.text).toBe('a');
    expect(r.start).toBe(0);
    expect(r.end).toBe(1);
  });

  it('a caret at a pure delete boundary (no insert) clamps to the boundary', () => {
    // "abcd", caret at 2 (end of "ab"); remote deletes "ab" (nothing inserted).
    const r = applyTextDelta('abcd', [{ delete: 2 }, { retain: 2 }], 2, 2);
    expect(r.text).toBe('cd');
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });

  it('TC-23 two concurrent end inserts both survive, merged in arrival order', () => {
    // Receiver starts at "green" with the caret at the end. Alex's "red " and
    // Sam's " blue" arrive as separate remote deltas, each relative to the
    // receiver's current text. Every typed character is kept.
    let r = applyTextDelta('green', [{ insert: 'red ' }, { retain: 5 }], 5, 5);
    r = applyTextDelta(r.text, [{ retain: r.text.length }, { insert: ' blue' }], r.start, r.end);
    expect(r.text).toBe('red green blue');
    expect(r.start).toBe(14);
    expect(r.end).toBe(14);
  });

  it('a selection spanning an insert keeps both ends consistent', () => {
    // "abcdef", selection (1,4) = "bcd"; remote inserts "X" at 0.
    const r = applyTextDelta('abcdef', [{ insert: 'X' }, { retain: 6 }], 1, 4);
    expect(r.text).toBe('Xabcdef');
    expect(r.start).toBe(2);
    expect(r.end).toBe(5);
  });
});

describe('sticky.text: clampToLimit (length limit)', () => {
  it('TC-14 pasting 1,200 characters keeps exactly the first 1,000', () => {
    const pasted = proseOf(1200);
    expect(pasted).toHaveLength(1200);

    const kept = clampToLimit(pasted);

    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 999 characters plus one more are accepted (boundary)', () => {
    const atLimit = proseOf(999) + 'x';
    expect(atLimit).toHaveLength(1000);

    expect(clampToLimit(atLimit)).toBe(atLimit);
  });

  it('TC-16 one character beyond the limit is rejected (negative/boundary)', () => {
    const over = proseOf(1000) + 'x';
    expect(over).toHaveLength(1001);

    const kept = clampToLimit(over);
    expect(kept).toHaveLength(1000);
    expect(kept).toBe(proseOf(1000));
  });

  it('short text passes through unchanged and honours a custom max', () => {
    expect(clampToLimit('Faster onboarding')).toBe('Faster onboarding');
    expect(clampToLimit('abcdefgh', 5)).toBe('abcde');
  });
});

describe('sticky.text: counterVisible (counter threshold)', () => {
  it('TC-17 shows only within 50 characters of the limit (949/950/951)', () => {
    // 1000 - 949 = 51 remaining -> hidden; 1000 - 950 = 50 -> shown.
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is hidden for short notes and visible at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
