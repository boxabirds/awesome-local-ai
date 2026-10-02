import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';

interface TextDelta {
  retain?: number;
  insert?: string | object;
  delete?: number;
}

function makeLongText(length: number): string {
  // Build realistic English text of approximately the given length
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'pack', 'my', 'box', 'with', 'five', 'dozen', 'liquor', 'jugs', 'how', 'vexingly', 'daft', 'zebras'];
  let text = '';
  while (text.length < length) {
    const w = words[Math.floor(Math.random() * words.length)];
    if (text.length + w.length + 1 > length) break;
    text += (text.length > 0 ? ' ' : '') + w;
  }
  // Pad exactly to length if needed
  while (text.length < length) {
    text += 'a';
  }
  return text.slice(0, length);
}

describe('sticky-text', () => {
  // TC-13: applyTextDiff produces minimal diff
  describe('applyTextDiff', () => {
    it('TC-13: abc -> abXc produces a single insert of X at index 2', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, 'abc');

      const deltas: TextDelta[] = [];
      ytext.observe((event, _txn) => {
        deltas.push(...event.delta);
      });

      applyTextDiff(ytext, 'abXc', 'test');

      expect(ytext.toString()).toBe('abXc');
      // Should be a minimal diff: retain to position 2, then insert 'X'
      // (NOT delete-all + insert-all)
      const insertOps = deltas.filter((d) => d.insert);
      const deleteOps = deltas.filter((d) => d.delete);
      expect(deleteOps).toHaveLength(0);
      expect(insertOps).toHaveLength(1);
      expect(insertOps[0]).toEqual({ insert: 'X' });
    });

    it('TC-13: deletion in middle produces a single delete', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, 'abcde');

      const deltas: TextDelta[] = [];
      ytext.observe((event) => {
        deltas.push(...event.delta);
      });

      applyTextDiff(ytext, 'abde', 'test');

      expect(ytext.toString()).toBe('abde');
      // Should be a minimal diff: retain to position 2, then delete 1
      const insertOps = deltas.filter((d) => d.insert);
      const deleteOps = deltas.filter((d) => d.delete);
      expect(insertOps).toHaveLength(0);
      expect(deleteOps).toHaveLength(1);
      expect(deleteOps[0]).toEqual({ delete: 1 });
    });

    it('TC-13: replacement of a selection', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, 'hello world');

      const deltas: TextDelta[] = [];
      ytext.observe((event) => {
        deltas.push(...event.delta);
      });

      applyTextDiff(ytext, 'hello earth', 'test');

      expect(ytext.toString()).toBe('hello earth');
      // 'world' -> 'earth': delete 5, insert 5
      const totalDeleted = deltas.reduce((sum, d) => sum + (d.delete ?? 0), 0);
      const totalInserted = deltas.reduce((sum, d) => sum + (typeof d.insert === 'string' ? d.insert.length : 0), 0);
      expect(totalDeleted).toBe(5);
      expect(totalInserted).toBe(5);
    });

    it('TC-13: emoji surrogate pairs kept intact', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, 'hello 🌍 world');

      applyTextDiff(ytext, 'hello 🌍🌎 world', 'test');

      expect(ytext.toString()).toBe('hello 🌍🌎 world');
    });

    it('TC-13: no change produces no deltas', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, 'abc');

      const deltas: TextDelta[] = [];
      ytext.observe((event) => {
        deltas.push(...event.delta);
      });

      applyTextDiff(ytext, 'abc', 'test');

      expect(deltas).toHaveLength(0);
    });
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  describe('clampToLimit', () => {
    it('TC-14: 1200 chars clamped to 1000', () => {
      const text = makeLongText(1200);
      const result = clampToLimit(text);
      expect(result).toHaveLength(1000);
      expect(result).toBe(text.slice(0, 1000));
    });

    it('TC-15: 999 + 1 = 1000 accepted (boundary)', () => {
      const text = makeLongText(1000);
      const result = clampToLimit(text);
      expect(result).toHaveLength(1000);
    });

    it('TC-16: 1000 + 1 rejected, still 1000', () => {
      const text = makeLongText(1001);
      const result = clampToLimit(text);
      expect(result).toHaveLength(1000);
      expect(result).toBe(text.slice(0, 1000));
    });

    it('short text passes through unchanged', () => {
      expect(clampToLimit('hello')).toBe('hello');
    });

    it('empty string passes through', () => {
      expect(clampToLimit('')).toBe('');
    });

    it('respects custom max parameter', () => {
      const text = 'abcdefghij';
      expect(clampToLimit(text, 5)).toBe('abcde');
    });
  });

  // TC-17: counterVisible at 949 / 950 / 951 chars
  describe('counterVisible', () => {
    it('TC-17: 949 chars → false (remaining 51 > threshold 50)', () => {
      expect(counterVisible(949)).toBe(false);
    });

    it('TC-17: 950 chars → true (remaining 50 = threshold 50)', () => {
      expect(counterVisible(950)).toBe(true);
    });

    it('TC-17: 951 chars → true (remaining 49 < threshold 50)', () => {
      expect(counterVisible(951)).toBe(true);
    });

    it('0 chars → false', () => {
      expect(counterVisible(0)).toBe(false);
    });

    it('1000 chars → true', () => {
      expect(counterVisible(1000)).toBe(true);
    });
  });
});
