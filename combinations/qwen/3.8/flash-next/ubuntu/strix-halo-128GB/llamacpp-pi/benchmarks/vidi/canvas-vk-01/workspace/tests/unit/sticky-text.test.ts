import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

// Realistic English text fixtures (not repeated single characters)
const SHORT_PHRASE = 'Faster onboarding';

function make1200(): string {
  let s = '';
  const word = 'collaboration';
  while (s.length < 1200) s += word + ' ';
  return s.slice(0, 1200);
}

describe('StickyText', () => {
  describe('clampToLimit', () => {
    it('TC-14: clamps 1200 chars to 1000', () => {
      const input = make1200();
      const result = clampToLimit(input);
      expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe(input.slice(0, STICKY_TEXT_MAX_CHARS));
    });

    it('TC-15: 999 + 1 = 1000 accepted (boundary)', () => {
      const input = 'x'.repeat(999) + '!';
      const result = clampToLimit(input);
      expect(result).toHaveLength(1000);
    });

    it('TC-16: 1000 + 1 rejected, still 1000 (boundary)', () => {
      const input = 'y'.repeat(1001);
      const result = clampToLimit(input);
      expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
    });

    it('passes through strings shorter than the limit', () => {
      const result = clampToLimit(SHORT_PHRASE);
      expect(result).toBe(SHORT_PHRASE);
    });

    it('handles empty string', () => {
      expect(clampToLimit('')).toBe('');
    });
  });

  describe('applyTextDiff', () => {
    function createYText(initial: string): { doc: Y.Doc; ytext: Y.Text } {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      doc.transact(() => {
        ytext.insert(0, initial);
      });
      return { doc, ytext };
    }

    it('TC-13: "abc" -> "abXc" produces a minimal insert at index 2', () => {
      const { ytext } = createYText('abc');
      let capturedDelta: Array<Record<string, unknown>> = [];
      ytext.observe((event) => {
        capturedDelta = event.delta as Array<Record<string, unknown>>;
      });

      applyTextDiff(ytext, 'abXc', null);

      // Should be a single insert (retain 2, insert 'X'), not delete-all + insert-all
      expect(capturedDelta).toHaveLength(2);
      expect(capturedDelta[0]!.retain).toBe(2);
      expect(capturedDelta[0]!.delete).toBeUndefined();
      expect(capturedDelta[1]!.insert).toBe('X');
      expect(ytext.toString()).toBe('abXc');
    });

    it('pure deletion in middle', () => {
      const { ytext } = createYText('hello world');
      let capturedDelta: Array<Record<string, unknown>> = [];
      ytext.observe((event) => {
        capturedDelta = event.delta as Array<Record<string, unknown>>;
      });

      applyTextDiff(ytext, 'hello rd', null);
      // common prefix 'hello ' (6), common suffix 'd' (1): delete 'worl' (4), insert 'r' (1)
      // NOT delete-all + insert-all
      const totalDeleted = capturedDelta.reduce((sum: number, op) => sum + ((op.delete as number) ?? 0), 0);
      const totalInserted = capturedDelta.reduce((sum: number, op) => sum + ((op.insert as string)?.length ?? 0), 0);
      expect(totalDeleted).toBe(4); // only 'worl' deleted
      expect(totalInserted).toBe(1); // only 'r' inserted
      expect(ytext.toString()).toBe('hello rd');
    });

    it('replacement of a selection', () => {
      const { ytext } = createYText('hello world');
      applyTextDiff(ytext, 'hello there', null);
      expect(ytext.toString()).toBe('hello there');
    });

    it('emoji surrogate pairs kept intact', () => {
      const { ytext } = createYText('Hello \u{1F600} World');
      applyTextDiff(ytext, 'Hello \u{1F600} Beautiful World', null);
      expect(ytext.toString()).toBe('Hello \u{1F600} Beautiful World');
    });

    it('no-op when text is unchanged', () => {
      const { ytext } = createYText('same');
      let fired = false;
      ytext.observe(() => { fired = true; });
      applyTextDiff(ytext, 'same', null);
      expect(fired).toBe(false);
    });
  });

  describe('counterVisible', () => {
    it('TC-17: 949 chars -> false (remaining 51)', () => {
      expect(counterVisible(949)).toBe(false);
    });

    it('TC-17: 950 chars -> true (remaining 50)', () => {
      expect(counterVisible(950)).toBe(true);
    });

    it('TC-17: 951 chars -> true (remaining 49)', () => {
      expect(counterVisible(951)).toBe(true);
    });

    it('empty text -> false', () => {
      expect(counterVisible(0)).toBe(false);
    });

    it('full text (1000) -> true', () => {
      expect(counterVisible(1000)).toBe(true);
    });
  });
});
