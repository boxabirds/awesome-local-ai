/**
 * Sticky text logic unit tests (TC-13 to TC-17).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';

describe('sticky-text', () => {
  describe('TC-13: applyTextDiff produces minimal changes', () => {
    it("'abc' -> 'abXc': single insert of 'X' at index 2", () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('t');
      doc.transact(() => ytext.insert(0, 'abc'));
      const deltas: unknown[][] = [];
      ytext.observe((event) => deltas.push(event.delta.map((op) => ({ ...op }))));
      applyTextDiff(ytext, 'abXc', null);
      expect(deltas).toHaveLength(1);
      // Must be exactly one insert, NOT delete-all+insert-all
      expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
    });

    it('pure deletion in middle', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('t');
      doc.transact(() => ytext.insert(0, 'abcdef'));
      const deltas: unknown[][] = [];
      ytext.observe((event) => deltas.push(event.delta.map((op) => ({ ...op }))));
      applyTextDiff(ytext, 'abef', null);
      expect(deltas).toHaveLength(1);
      // Should be a delete, not a full rewrite
      expect(deltas[0]).toEqual([{ retain: 2 }, { delete: 2 }]);
    });

    it('replacement of a selection', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('t');
      doc.transact(() => ytext.insert(0, 'hello world'));
      const deltas: unknown[][] = [];
      ytext.observe((event) => deltas.push(event.delta.map((op) => ({ ...op }))));
      applyTextDiff(ytext, 'hello there', null);
      expect(deltas).toHaveLength(1);
      expect(deltas[0]).toEqual([{ retain: 6 }, { delete: 5 }, { insert: 'there' }]);
    });

    it('emoji surrogate pairs kept intact', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('t');
      doc.transact(() => ytext.insert(0, 'hi 😀 bye'));
      ytext.observe(() => undefined);
      applyTextDiff(ytext, 'hi 😀!! bye', null);
      expect(ytext.toString()).toBe('hi 😀!! bye');
      // Ensure emoji was not broken
      const codepoints = Array.from(ytext.toString());
      expect(codepoints).toContain('😀');
    });

    it('no event emitted when text unchanged', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('t');
      doc.transact(() => ytext.insert(0, 'same'));
      const events: unknown[] = [];
      ytext.observe(() => events.push(1));
      applyTextDiff(ytext, 'same', null);
      expect(events).toHaveLength(0);
    });
  });

  describe('TC-14: clampToLimit pastes 1200 into empty -> 1000 kept', () => {
    it('clamps 1200 chars to STICKY_TEXT_MAX_CHARS', () => {
      const long = 'The quick brown fox jumps over the lazy dog. '.repeat(30); // >1000
      expect(long.length).toBeGreaterThan(STICKY_TEXT_MAX_CHARS);
      const clamped = clampToLimit(long);
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
      // Prefix preserved
      expect(clamped).toBe(long.slice(0, STICKY_TEXT_MAX_CHARS));
    });
  });

  describe('TC-15: 999 + 1 -> 1000 accepted', () => {
    it('accepts up to max', () => {
      const str = 'x'.repeat(STICKY_TEXT_MAX_CHARS - 1);
      const next = str + 'y';
      const clamped = clampToLimit(next);
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    });
  });

  describe('TC-16: 1000 + 1 -> rejected (still 1000)', () => {
    it('does not grow past max', () => {
      const str = 'x'.repeat(STICKY_TEXT_MAX_CHARS);
      const next = str + 'y';
      const clamped = clampToLimit(next);
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(str);
    });
  });

  describe('TC-17: counterVisible boundaries', () => {
    it('false at 949 (remaining 51)', () => {
      expect(counterVisible(STICKY_TEXT_MAX_CHARS - 51)).toBe(false);
    });
    it('true at 950 (remaining 50)', () => {
      expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true);
    });
    it('true at 951 (remaining 49)', () => {
      expect(counterVisible(STICKY_TEXT_MAX_CHARS - 49)).toBe(true);
    });
    it('false at 0 (remaining 1000)', () => {
      expect(counterVisible(0)).toBe(false);
    });
  });
});
