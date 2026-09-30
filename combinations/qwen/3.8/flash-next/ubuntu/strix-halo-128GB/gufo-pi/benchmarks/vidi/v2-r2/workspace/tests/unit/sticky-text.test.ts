import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '@client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';

// Realistic English prose fixture (1000 chars)
const PROSE_1000 =
  'The quick brown fox jumps over the lazy dog near the riverbank where wildflowers ' +
  'bloom in early spring and children play under the shade of ancient oak trees. ' +
  'Scientists have discovered that bees communicate through intricate dance patterns, ' +
  'revealing the location of nectar sources to their hive mates with remarkable precision. ' +
  'The history of cartography stretches back thousands of years, from clay tablets to ' +
  'satellite imagery. Music has the power to evoke deep emotions, connecting people across ' +
  'cultures and generations in shared experiences of rhythm and melody that transcend language. ' +
  'Mathematics provides the universal language through which we describe the natural world, ' +
  'from the spiral of a nautilus shell to the orbits of distant galaxies. Collaboration drives ' +
  'innovation forward when diverse teams come together with shared purpose and mutual respect.';

// Ensure fixture is exactly 1000 chars (pad or trim if needed)
const FIXTURE_1000 = PROSE_1000.slice(0, 1000).padEnd(1000, ' ');

describe('sticky-text', () => {
  describe('clampToLimit', () => {
    // TC-14
    it('TC-14: clamps 1200 chars to 1000', () => {
      const input = FIXTURE_1000 + 'x'.repeat(200);
      const result = clampToLimit(input);
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe(FIXTURE_1000);
    });

    // TC-15
    it('TC-15: 999 + 1 = 1000 accepted (boundary)', () => {
      const input = 'a'.repeat(999) + 'b';
      const result = clampToLimit(input);
      expect(result.length).toBe(1000);
    });

    // TC-16
    it('TC-16: 1000 + 1 = rejected, still 1000', () => {
      const input = 'a'.repeat(1001);
      const result = clampToLimit(input);
      expect(result.length).toBe(1000);
    });

    it('short text is unchanged', () => {
      const input = 'hello world';
      expect(clampToLimit(input)).toBe(input);
    });
  });

  describe('applyTextDiff', () => {
    function makeDoc(initial: string): Y.Text {
      const doc = new Y.Doc();
      const ytext = doc.getText('test');
      ytext.insert(0, initial);
      return ytext;
    }

    // TC-13
    it('TC-13: "abc" → "abXc" produces single insert of "X" at index 2', () => {
      const ytext = makeDoc('abc');
      const events: Array<{ insert?: string; delete?: number; retain?: number }> = [];
      ytext.observe((event) => {
        for (const op of event.delta) {
          events.push(op as { insert?: string; delete?: number; retain?: number });
        }
      });
      applyTextDiff(ytext, 'abXc', null);
      expect(ytext.toString()).toBe('abXc');
      // Must be a single insert, not delete-all + insert-all
      const inserts = events.filter((e) => e.insert !== undefined);
      const deletes = events.filter((e) => e.delete !== undefined);
      expect(inserts.length).toBe(1);
      expect(inserts[0].insert).toBe('X');
      expect(deletes.length).toBe(0);
    });

    it('TC-13b: deletion in middle produces single delete', () => {
      const ytext = makeDoc('abcdef');
      const events: Array<{ insert?: string; delete?: number; retain?: number }> = [];
      ytext.observe((event) => {
        for (const op of event.delta) {
          events.push(op as { insert?: string; delete?: number; retain?: number });
        }
      });
      applyTextDiff(ytext, 'abef', null);
      expect(ytext.toString()).toBe('abef');
      // Should be exactly one delete (plus retain ops for positioning)
      const deletes = events.filter((e) => e.delete !== undefined);
      expect(deletes.length).toBe(1);
      expect(deletes[0].delete).toBe(2);
    });

    it('TC-13c: replacement produces delete + insert', () => {
      const ytext = makeDoc('hello world');
      applyTextDiff(ytext, 'hello there', null);
      expect(ytext.toString()).toBe('hello there');
    });

    it('TC-13d: no change produces no events', () => {
      const ytext = makeDoc('same');
      let eventCount = 0;
      ytext.observe(() => eventCount++);
      applyTextDiff(ytext, 'same', null);
      expect(eventCount).toBe(0);
    });

    it('TC-13e: emoji surrogate pairs kept intact', () => {
      const ytext = makeDoc('hi 👋 there');
      applyTextDiff(ytext, 'hi 👋 their', null);
      expect(ytext.toString()).toBe('hi 👋 their');
      // Verify the emoji is intact
      expect(ytext.toString().includes('👋')).toBe(true);
    });
  });

  describe('counterVisible', () => {
    // TC-17
    it('TC-17: 949 chars → false (remaining 51 > threshold)', () => {
      expect(counterVisible(949)).toBe(false);
    });

    it('TC-17: 950 chars → true (remaining 50 = threshold)', () => {
      expect(counterVisible(950)).toBe(true);
    });

    it('TC-17: 951 chars → true (remaining 49 < threshold)', () => {
      expect(counterVisible(951)).toBe(true);
    });

    it('empty text → false', () => {
      expect(counterVisible(0)).toBe(false);
    });

    it('at limit (1000) → true', () => {
      expect(counterVisible(1000)).toBe(true);
    });
  });
});
