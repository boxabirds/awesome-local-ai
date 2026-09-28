import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from 'src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from 'src/shared/config';
import { LONG_TEXT, SHORT_TEXT } from 'tests/fixtures/texts';

/** Creates a Y.Text attached to a fresh doc (Yjs requires a doc to store data). */
function makeYText(): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = new Y.Text();
  doc.getMap('root').set('text', ytext);
  return { doc, ytext };
}

/**
 * Collects the mutating Y.Text delta operations (insert/delete steps; the
 * `retain` steps that locate them are filtered out, as they carry no change).
 */
function observeDeltas(ytext: Y.Text): Array<{ insert?: string; delete?: number }> {
  const deltas: Array<{ insert?: string; delete?: number }> = [];
  ytext.observe((event) => {
    for (const d of event.delta) {
      const step = d as { insert?: string; delete?: number; retain?: number };
      if (step.insert !== undefined || step.delete !== undefined) {
        deltas.push({ insert: step.insert, delete: step.delete });
      }
    }
  });
  return deltas;
}

describe('sticky.text: applyTextDiff', () => {
  it('TC-13: abc → abXc is a single insert of X at index 2 (no delete)', () => {
    const { ytext } = makeYText();
    ytext.insert(0, 'abc');

    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'abXc', 'test');

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([{ insert: 'X' }]);
  });

  it('TC-13: pure deletion in the middle is a single delete', () => {
    const { ytext } = makeYText();
    ytext.insert(0, 'abcdef');

    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'abdef', 'test');

    expect(ytext.toString()).toBe('abdef');
    expect(deltas).toEqual([{ delete: 1 }]);
  });

  it('TC-13: replacing a selection is one delete + one insert (not delete-all + insert-all)', () => {
    const { ytext } = makeYText();
    ytext.insert(0, 'The quick brown fox');

    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'The slow brown fox', 'test');

    expect(ytext.toString()).toBe('The slow brown fox');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toEqual({ delete: 5 });
    expect(deltas[1]).toEqual({ insert: 'slow' });
  });

  it('TC-13: emoji surrogate pairs are kept intact', () => {
    const { ytext } = makeYText();
    ytext.insert(0, 'hi 😀');

    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'hi 😀!', 'test');

    expect(ytext.toString()).toBe('hi 😀!');
    expect(deltas).toEqual([{ insert: '!' }]);

    // Replace the emoji with two different emojis: the whole pair must be one
    // delete of 2 units and one insert of the new pair.
    const deltas2 = observeDeltas(ytext);
    applyTextDiff(ytext, 'hi 🚀!', 'test');
    expect(ytext.toString()).toBe('hi 🚀!');
    expect(deltas2).toEqual([{ delete: 2 }, { insert: '🚀' }]);
  });

  it('is a no-op when the text is unchanged (no transaction, no events)', () => {
    const { doc, ytext } = makeYText();
    ytext.insert(0, SHORT_TEXT);
    const deltas = observeDeltas(ytext);
    let updates = 0;
    doc.on('update', () => updates++);

    applyTextDiff(ytext, SHORT_TEXT, 'test');

    expect(deltas).toEqual([]);
    expect(updates).toBe(0);
  });
});

describe('sticky.text: clampToLimit', () => {
  it('TC-14: pasting 1,200 chars into an empty note keeps exactly 1,000', () => {
    const pasted = LONG_TEXT + 'x'.repeat(200);
    expect(pasted.length).toBe(1200);
    const kept = clampToLimit(pasted);
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(LONG_TEXT);
  });

  it('TC-15: 999 chars + 1 accepted (boundary)', () => {
    const base = LONG_TEXT.slice(0, 999);
    expect(base.length).toBe(999);
    const kept = clampToLimit(base + 'a');
    expect(kept.length).toBe(1000);
    expect(kept).toBe(base + 'a');
  });

  it('TC-16: 1,000 chars + 1 rejected, still 1,000 (negative/boundary)', () => {
    const kept = clampToLimit(LONG_TEXT + 'a');
    expect(kept.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(LONG_TEXT);
  });

  it('short text passes through unchanged', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit('')).toBe('');
  });

  it('honours an explicit max', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text: counterVisible', () => {
  it(`TC-17: ${949} / ${950} / ${951} chars → false / true / true (remaining ${STICKY_TEXT_MAX_CHARS - 949} / ${STICKY_TEXT_MAX_CHARS - 950} / ${STICKY_TEXT_MAX_CHARS - 951})`, () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('visible exactly at the threshold boundary, hidden one char below', () => {
    const atThreshold = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    expect(counterVisible(atThreshold)).toBe(true);
    expect(counterVisible(atThreshold - 1)).toBe(false);
  });

  it('hidden for short text and at length 0', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_TEXT.length)).toBe(false);
  });
});
