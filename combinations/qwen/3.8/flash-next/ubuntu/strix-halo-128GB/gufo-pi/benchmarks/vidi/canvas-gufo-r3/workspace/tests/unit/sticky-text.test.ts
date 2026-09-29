import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '@client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '@shared/config';

// Realistic English prose fixtures (not repeated single characters).
function proseParagraph(targetLength: number): string {
  const sentences = [
    'The team reflected on the onboarding experience and how confusing the first week felt. ',
    'Documentation was scattered across wikis, chat threads and tribal knowledge. ',
    'New hires wanted a single checklist they could follow at their own pace. ',
    'Mentors suggested pairing sessions during the first two sprints to build confidence. ',
    'Follow-up actions were captured as sticky notes and grouped by theme on the board. ',
  ];
  let out = '';
  while (out.length < targetLength) out += sentences[out.length % sentences.length] + ' ';
  return out.slice(0, targetLength);
}

interface DeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
}

function observeDeltas(ytext: Y.Text, fn: () => void): DeltaOp[][] {
  const events: DeltaOp[][] = [];
  const handler = (e: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.local) events.push(e.delta as DeltaOp[]);
  };
  ytext.observe(handler);
  fn();
  ytext.unobserve(handler);
  return events;
}

describe('sticky-text', () => {
  describe('TC-13: applyTextDiff produces minimal ops', () => {
    it("'abc' -> 'abXc' is a single insert of 'X' at index 2", () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      ytext.insert(0, 'abc');
      const events = observeDeltas(ytext, () => applyTextDiff(ytext, 'abXc', null));
      expect(events.length).toBe(1);
      expect(events[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
      expect(ytext.toString()).toBe('abXc');
    });

    it('pure deletion in the middle emits a single delete', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      ytext.insert(0, 'abcdef');
      const events = observeDeltas(ytext, () => applyTextDiff(ytext, 'abef', null));
      expect(events.length).toBe(1);
      expect(events[0]).toEqual([{ retain: 2 }, { delete: 2 }]);
      expect(ytext.toString()).toBe('abef');
    });

    it('replacement of a selection emits one delete + one insert', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      ytext.insert(0, 'hello world');
      const events = observeDeltas(ytext, () => applyTextDiff(ytext, 'hello brave world', null));
      expect(events.length).toBe(1);
      // Must not be delete-all + insert-all
      const deletesAll = events[0].some((op) => op.delete === 'hello world'.length);
      expect(deletesAll).toBe(false);
      expect(ytext.toString()).toBe('hello brave world');
    });

    it('keeps emoji surrogate pairs intact', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      ytext.insert(0, 'ship 🚀 it');
      const events = observeDeltas(ytext, () => applyTextDiff(ytext, 'ship 🚀 it!', null));
      expect(events.length).toBe(1);
      expect(events[0]).toEqual([{ retain: 'ship 🚀 it'.length }, { insert: '!' }]);
      expect(ytext.toString()).toBe('ship 🚀 it!');
    });

    it('does not split a surrogate pair when appending in the middle', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      ytext.insert(0, 'a🚀b');
      applyTextDiff(ytext, 'a🚀Xb', null);
      expect(ytext.toString()).toBe('a🚀Xb');
    });
  });

  describe('TC-14: paste of 1,200 chars clamps to 1,000', () => {
    it('keeps the first STICKY_TEXT_MAX_CHARS characters', () => {
      const long = proseParagraph(1200);
      const clamped = clampToLimit(long);
      expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(clamped).toBe(long.slice(0, STICKY_TEXT_MAX_CHARS));
    });
  });

  describe('TC-15: 999 + 1 accepted', () => {
    it('999 chars plus one becomes 1,000', () => {
      const base = proseParagraph(999);
      const result = clampToLimit(base + '!');
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(result.endsWith('!')).toBe(true);
    });
  });

  describe('TC-16: 1,000 + 1 rejected', () => {
    it('stays at 1,000 characters', () => {
      const base = proseParagraph(1000);
      const result = clampToLimit(base + '!');
      expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(result).toBe(base);
    });

    it('applyTextDiff clamps writes beyond the limit', () => {
      const doc = new Y.Doc();
      const ytext = doc.getText('note');
      const base = proseParagraph(1000);
      ytext.insert(0, base);
      applyTextDiff(ytext, base + 'overflow', null);
      expect(ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
      expect(ytext.toString()).toBe(base);
    });
  });

  describe('TC-17: counterVisible boundary', () => {
    it('949 → false, 950 → true, 951 → true (remaining 51/50/49)', () => {
      expect(counterVisible(949)).toBe(false);
      expect(counterVisible(950)).toBe(true);
      expect(counterVisible(951)).toBe(true);
    });

    it('boundary is STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS', () => {
      const boundary = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
      expect(counterVisible(boundary - 1)).toBe(false);
      expect(counterVisible(boundary)).toBe(true);
    });
  });
});
