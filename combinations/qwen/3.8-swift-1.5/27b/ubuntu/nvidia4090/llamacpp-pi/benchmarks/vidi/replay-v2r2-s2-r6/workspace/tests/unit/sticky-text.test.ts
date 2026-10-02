import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_PROSE_1000, LONG_PROSE_1200 } from '../fixtures/texts';

/**
 * Collects the Y.Text delta events emitted while `fn` runs.
 * A minimal diff for a single edit is one retain + one insert and/or one delete.
 * A delete-all + insert-all would be one large delete + one large insert,
 * which would destroy concurrent typing in story 3.
 */
/** A Y.Text attached to a real Y.Doc (as it is in the board model). */
function makeText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  return ytext;
}

type TextDiff = Y.YTextEvent['delta'][number];

function collectDeltas(ytext: Y.Text, fn: () => void): TextDiff[] {
  const deltas: TextDiff[] = [];
  const handler = (events: Y.YEvent<Y.Text>[]) => {
    for (const e of events) {
      if (e instanceof Y.YTextEvent) deltas.push(...e.delta);
    }
  };
  ytext.observeDeep(handler);
  fn();
  ytext.unobserveDeep(handler);
  return deltas;
}

describe('sticky.text unit (TC-13 to TC-17)', () => {
  describe('applyTextDiff (TC-13)', () => {
    it('TC-13a insert in the middle: single insert of X at index 2, no delete+insert-all', () => {
      const ytext = makeText('abc');

      const deltas = collectDeltas(ytext, () => applyTextDiff(ytext, 'abXc', 'test-origin'));

      expect(ytext.toString()).toBe('abXc');
      expect(deltas).toEqual([{ retain: 2 }, { insert: 'X' }]);
    });

    it('TC-13b pure deletion in the middle: one delete, no inserts', () => {
      const ytext = makeText('hello world');

      const deltas = collectDeltas(ytext, () => applyTextDiff(ytext, 'helloworld', 'test-origin'));

      expect(ytext.toString()).toBe('helloworld');
      expect(deltas).toEqual([{ retain: 5 }, { delete: 1 }]);
    });

    it('TC-13c replacement of a selection: one delete + one insert of the changed part only', () => {
      const ytext = makeText('The quick brown fox');

      const deltas = collectDeltas(ytext, () => applyTextDiff(ytext, 'The quick red fox', 'test-origin'));

      expect(ytext.toString()).toBe('The quick red fox');
      expect(deltas).toEqual([{ retain: 10 }, { delete: 5 }, { insert: 'red' }]);
    });

    it('TC-13d emoji surrogate pairs stay intact', () => {
      const ytext = makeText('hello \u{1F496} world'); // 💖

      const deltas = collectDeltas(ytext, () =>
        applyTextDiff(ytext, 'hello \u{1F499} world', 'test-origin'), // 💙
      );

      expect(ytext.toString()).toBe('hello \u{1F499} world');
      // The diff must not split the surrogate pair (Y.Text cannot encode
      // lone surrogates): the whole pair is replaced, no U+FFFD corruption.
      expect(deltas).toEqual([{ retain: 6 }, { delete: 2 }, { insert: '\u{1F499}' }]);
    });

    it('no-op diff emits no changes', () => {
      const ytext = makeText('unchanged');

      const deltas = collectDeltas(ytext, () => applyTextDiff(ytext, 'unchanged', 'test-origin'));

      expect(ytext.toString()).toBe('unchanged');
      expect(deltas).toEqual([]);
    });
  });

  describe('clampToLimit (TC-14 to TC-16)', () => {
    it('TC-14 paste of 1,200 chars into empty → exactly 1,000 kept (the first 1,000)', () => {
      expect(LONG_PROSE_1200).toHaveLength(1200);
      const clamped = clampToLimit(LONG_PROSE_1200);
      expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(LONG_PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    });

    it('TC-15 999 chars + 1 → 1,000 accepted (boundary)', () => {
      const at999 = LONG_PROSE_1200.slice(0, 999);
      const withOneMore = at999 + 'x';
      expect(withOneMore).toHaveLength(1000);
      const clamped = clampToLimit(withOneMore);
      expect(clamped).toHaveLength(1000);
      expect(clamped).toBe(withOneMore);
    });

    it('TC-16 1,000 chars + 1 → rejected, still exactly 1,000 (negative boundary)', () => {
      const at1000 = LONG_PROSE_1200.slice(0, 1000);
      const withOneMore = at1000 + 'x';
      expect(withOneMore).toHaveLength(1001);
      const clamped = clampToLimit(withOneMore);
      expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(at1000);
    });

    it('short texts pass through unchanged', () => {
      expect(clampToLimit('')).toBe('');
      expect(clampToLimit('Faster onboarding')).toBe('Faster onboarding');
      expect(clampToLimit(LONG_PROSE_1000)).toBe(LONG_PROSE_1000);
    });

    it('honours an explicit max', () => {
      expect(clampToLimit('abcdef', 3)).toBe('abc');
    });
  });

  describe('counterVisible (TC-17)', () => {
    it('TC-17 at 949 / 950 / 951 chars → false / true / true', () => {
      // remaining: 51 / 50 / 49; threshold is 50 (visible when remaining <= 50)
      expect(counterVisible(949)).toBe(false);
      expect(counterVisible(950)).toBe(true);
      expect(counterVisible(951)).toBe(true);
    });

    it('at the limit and at zero', () => {
      expect(counterVisible(0)).toBe(false);
      expect(counterVisible(1)).toBe(false);
      expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    });
  });
});
