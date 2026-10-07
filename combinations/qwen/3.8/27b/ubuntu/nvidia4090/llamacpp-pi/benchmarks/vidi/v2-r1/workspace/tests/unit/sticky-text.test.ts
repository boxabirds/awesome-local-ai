// Story 2, sticky.text unit tests (TC-13 to TC-17).
// Pure logic against a real Y.Text — no mocks.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { PROSE_1000, PROSE_1200, makeProse } from '../fixtures/texts';

/** A Y.Text attached to a fresh document (Yjs 13: standalone types hold no data). */
function makeText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText('text');
  text.insert(0, initial);
  return text;
}

interface TextOp {
  insert?: string;
  retain?: number;
  path?: [number, number];
}

/** Collect the insert ops emitted by a Y.Text while `fn` runs.
 *  (Deletions never appear in Yjs deltas; retains are filtered out.) */
function collectInserts(ytext: Y.Text, fn: () => void): TextOp[] {
  const ops: TextOp[] = [];
  const handler = (event: Y.YTextEvent) => {
    for (const op of event.delta as TextOp[]) {
      if (typeof op.insert === 'string') ops.push(op);
    }
  };
  ytext.observe(handler);
  try {
    fn();
  } finally {
    ytext.unobserve(handler);
  }
  return ops;
}

describe('sticky.text (story 2)', () => {
  describe('applyTextDiff', () => {
    it('TC-13: an interior change is a single insert, not delete-all + insert-all', () => {
      const ytext = makeText('abc');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('abXc');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ insert: 'X' });
    });

    it('TC-13: a pure interior deletion emits no insert ops', () => {
      const ytext = makeText('abcd');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'ad', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('ad');
      expect(ops).toHaveLength(0);
    });

    it('TC-13: replacing a selected character is one delete + one insert', () => {
      const ytext = makeText('abc');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'aXc', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('aXc');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ insert: 'X' });
    });

    it('TC-13: emoji surrogate pairs stay intact at diff boundaries', () => {
      const ytext = makeText('a😀b');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'a😀😀b', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('a😀😀b');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ insert: '😀' });
    });

    it('TC-13: replacing text next to an emoji keeps the pair intact', () => {
      const ytext = makeText('a😀bc');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'a😀Xc', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('a😀Xc');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ insert: 'X' });
    });

    it('no change: identical text emits no ops and no transaction', () => {
      const ytext = makeText('abc');
      const doc = ytext.doc as Y.Doc;
      let updates = 0;
      const listener = () => {
        updates += 1;
      };
      doc.on('update', listener);
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'abc', LOCAL_ORIGIN));
      doc.off('update', listener);
      expect(ops).toHaveLength(0);
      expect(updates).toBe(0);
    });

    it('whole-text replacement still uses the common prefix/suffix', () => {
      const ytext = makeText('abc');
      const ops = collectInserts(ytext, () => applyTextDiff(ytext, 'xyz', LOCAL_ORIGIN));
      expect(ytext.toString()).toBe('xyz');
      // No shared prefix/suffix: a single insert of the whole new text
      // (deletions never appear in deltas).
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ insert: 'xyz' });
    });
  });

  describe('clampToLimit', () => {
    it('TC-14: pasting 1,200 characters into an empty note keeps exactly 1,000', () => {
      expect(PROSE_1200.length).toBe(1200);
      const clamped = clampToLimit(PROSE_1200);
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(PROSE_1000);
    });

    it('TC-15: 999 + 1 characters is accepted (boundary)', () => {
      const clamped = clampToLimit(makeProse(999) + 'x');
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    });

    it('TC-16: 1,000 + 1 does not grow beyond the limit (negative/boundary)', () => {
      const clamped = clampToLimit(PROSE_1000 + 'x');
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(PROSE_1000);
    });

    it('short text passes through unchanged', () => {
      expect(clampToLimit('')).toBe('');
      expect(clampToLimit('abc')).toBe('abc');
    });

    it('respects a custom max', () => {
      expect(clampToLimit('abcdef', 4)).toBe('abcd');
    });
  });

  describe('counterVisible', () => {
    it('TC-17: counter is hidden above the threshold and shown at or below it', () => {
      const at = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS; // 950
      expect(counterVisible(at - 1)).toBe(false); // 949 → 51 remaining
      expect(counterVisible(at)).toBe(true); // 950 → 50 remaining
      expect(counterVisible(at + 1)).toBe(true); // 951 → 49 remaining
      expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
      expect(counterVisible(0)).toBe(false);
    });
  });
});
