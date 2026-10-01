// tests/unit/sticky-text.test.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

type TextDelta = { insert?: string | object; delete?: number; retain?: number; attributes?: Record<string, unknown> };

// Generate a 1000+ char realistic English paragraph
function makeLongText(minLen: number): string {
  const sentences = [
    'The quick brown fox jumps over the lazy dog. ',
    'Pack my box with five dozen liquor jugs. ',
    'How quickly daft jumping zebras vex. ',
    'Sphinx of black quartz judge my vow. ',
    'The jay flick and dx7 print my ghastly quiz. ',
    'Bright vixens jump dozy fowl quack. ',
    'The five boxing wizards jump quickly. ',
    'Jackdaws love my big sphinx of quartz. ',
    'The wizard quickly jinxed the gnomes before they vaporized his loose toad. ',
    'Clever foxes bring us nine packs of jolly wood. ',
  ];
  let result = '';
  while (result.length < minLen) {
    result += sentences[result.length % sentences.length];
  }
  return result.slice(0, minLen);
}

describe('sticky.text', () => {
  // TC-13: applyTextDiff minimal change
  describe('TC-13: applyTextDiff', () => {
    function makeText(initial: string): Y.Text {
      const doc = new Y.Doc();
      const ytext = new Y.Text();
      doc.getMap('root').set('text', ytext);
      ytext.insert(0, initial);
      return ytext;
    }

    it('produces a single insert for abc -> abXc', () => {
      const ytext = makeText('abc');
      
      // Observe the changes
      const deltas: TextDelta[] = [];
      const handler = (event: Y.YTextEvent) => { deltas.push(...event.delta as TextDelta[]); };
      ytext.observe(handler);

      applyTextDiff(ytext, 'abXc');
      ytext.unobserve(handler);

      // Should be a single insert of 'X' at position 2 (with retain before)
      // Not delete+insert-all, which would break concurrent typing
      expect(deltas).toEqual([{ retain: 2 }, { insert: 'X' }]);
      expect(ytext.toString()).toBe('abXc');
    });

    it('handles pure deletion in the middle', () => {
      const ytext = makeText('abcde');
      
      const deltas: TextDelta[] = [];
      const handler = (event: Y.YTextEvent) => { deltas.push(...event.delta as TextDelta[]); };
      ytext.observe(handler);

      applyTextDiff(ytext, 'acde');
      ytext.unobserve(handler);

      // Single deletion of 1 char at position 1 (with retain before)
      expect(deltas).toEqual([{ retain: 1 }, { delete: 1 }]);
      expect(ytext.toString()).toBe('acde');
    });

    it('handles replacement of a selection', () => {
      const ytext = makeText('hello world');
      
      const deltas: TextDelta[] = [];
      const handler = (event: Y.YTextEvent) => { deltas.push(...event.delta as TextDelta[]); };
      ytext.observe(handler);

      applyTextDiff(ytext, 'hello earth');
      ytext.unobserve(handler);

      expect(ytext.toString()).toBe('hello earth');
    });

    it('keeps emoji surrogate pairs intact', () => {
      const ytext = makeText('hello 🎉 world');
      
      applyTextDiff(ytext, 'hello 🎉🎊 world');
      expect(ytext.toString()).toBe('hello 🎉🎊 world');
    });

    it('no-op when text is the same', () => {
      const ytext = makeText('abc');
      
      const deltas: TextDelta[] = [];
      const handler = (event: Y.YTextEvent) => { deltas.push(...event.delta as TextDelta[]); };
      ytext.observe(handler);

      applyTextDiff(ytext, 'abc');
      ytext.unobserve(handler);

      expect(deltas).toHaveLength(0);
    });
  });

  // TC-14: paste of 1200 chars into empty → 1000 kept
  describe('TC-14: clampToLimit paste 1200 chars', () => {
    it('keeps exactly 1000 characters', () => {
      const long = makeLongText(1200);
      const result = clampToLimit(long);
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe(long.slice(0, 1000));
    });
  });

  // TC-15: 999 + 1 → 1000 accepted
  describe('TC-15: 999 + 1 = 1000 boundary', () => {
    it('accepts exactly 1000 characters', () => {
      const text999 = makeLongText(999);
      const result = clampToLimit(text999 + 'a');
      expect(result.length).toBe(1000);
    });
  });

  // TC-16: 1000 + 1 → rejected, still 1000
  describe('TC-16: 1000 + 1 = 1001 rejected', () => {
    it('keeps at 1000 characters', () => {
      const text1000 = makeLongText(1000);
      const result = clampToLimit(text1000 + 'a');
      expect(result.length).toBe(1000);
      expect(result).toBe(text1000);
    });
  });

  // TC-17: counterVisible at boundaries
  describe('TC-17: counterVisible boundaries', () => {
    it('949 chars → false (remaining 51 > 50)', () => {
      expect(counterVisible(949)).toBe(false);
    });
    it('950 chars → true (remaining 50 <= 50)', () => {
      expect(counterVisible(950)).toBe(true);
    });
    it('951 chars → true (remaining 49 <= 50)', () => {
      expect(counterVisible(951)).toBe(true);
    });
  });

  // Extra: clampToLimit with various inputs
  describe('clampToLimit', () => {
    it('returns short strings unchanged', () => {
      expect(clampToLimit('hello')).toBe('hello');
    });
    it('returns empty string unchanged', () => {
      expect(clampToLimit('')).toBe('');
    });
    it('respects custom max', () => {
      expect(clampToLimit('hello world', 5)).toBe('hello');
    });
  });
});
