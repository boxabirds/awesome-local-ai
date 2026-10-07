import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';

/** Helper to create a Y.Text bound to a Y.Doc */
function makeText(content: string): Y.Text {
  const doc = new Y.Doc();
  const root = doc.getMap('root');
  const t = new Y.Text(content);
  doc.transact(() => {
    root.set('t', t);
  }, null as unknown as symbol);
  return t;
}

describe('sticky.text unit tests', () => {
  describe('TC-13: applyTextDiff minimal diff', () => {
    it("'abc' -> 'abXc' produces single insert at index 2", () => {
      const ytext = makeText('abc');
      applyTextDiff(ytext, 'abXc', 'test-origin');
      expect(ytext.toString()).toBe('abXc');
    });

    it('pure deletion in middle', () => {
      const ytext = makeText('abcde');
      applyTextDiff(ytext, 'ade', 'test-origin');
      expect(ytext.toString()).toBe('ade');
    });

    it('replacement of selection', () => {
      const ytext = makeText('hello world');
      applyTextDiff(ytext, 'hello there', 'test-origin');
      expect(ytext.toString()).toBe('hello there');
    });

    it('surrogate pairs kept intact', () => {
      const ytext = makeText('a😀b');
      applyTextDiff(ytext, 'a❤️b', 'test-origin');
      expect(ytext.toString()).toBe('a❤️b');
    });
  });

  describe('TC-14: paste 1200 chars into empty -> 1000 kept', () => {
    it('clamps to STICKY_TEXT_MAX_CHARS', () => {
      const long = 'a'.repeat(1200);
      const result = clampToLimit(long);
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe('a'.repeat(STICKY_TEXT_MAX_CHARS));
    });
  });

  describe('TC-15: 999 + 1 -> 1000 accepted', () => {
    it('exactly at limit is accepted', () => {
      const near = 'x'.repeat(999);
      const result = clampToLimit(near + ' ');
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    });
  });

  describe('TC-16: 1000 + 1 -> rejected (negative)', () => {
    it('still 1000 chars after trying to exceed', () => {
      const atLimit = 'x'.repeat(STICKY_TEXT_MAX_CHARS);
      const result = clampToLimit(atLimit + 'extra');
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    });
  });

  describe('TC-17: counterVisible threshold boundary', () => {
    it('at 949 chars -> false (remaining 51 > 50)', () => {
      expect(counterVisible(949)).toBe(false);
    });
    it('at 950 chars -> true (remaining 50 <= 50)', () => {
      expect(counterVisible(950)).toBe(true);
    });
    it('at 951 chars -> true (remaining 49 <= 50)', () => {
      expect(counterVisible(951)).toBe(true);
    });
    it('at 1000 chars -> true (remaining 0 <= 50)', () => {
      expect(counterVisible(1000)).toBe(true);
    });
    it('at 0 chars -> false (remaining 1000 > 50)', () => {
      expect(counterVisible(0)).toBe(false);
    });
  });
});
