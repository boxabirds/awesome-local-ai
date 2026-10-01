// tests/unit/undo-boundaries.test.ts
// TC-12, TC-13: typing-burst grouping via the capture timeout, with a
// controllable clock so the boundary values can be tested exactly.
//
// yjs reads time via lib0/time#getUnixTime (a captured reference to
// Date.now at module load), so vi.useFakeTimers does NOT affect it. Instead
// we mock lib0/time with a hoisted mutable clock.
//
// Typing is applied with LOCAL_ORIGIN (as the app's applyTextDiff does), so
// it enters the per-client history and is grouped by the capture timeout.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock('lib0/time', () => ({
  getUnixTime: () => clock.now,
  getDate: () => new Date(clock.now),
  humanizeDuration: (d: number) => `${d}ms`,
}));

import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

describe('undo.boundaries: typing bursts (unit)', () => {
  beforeEach(() => {
    // Non-zero start: yjs's merge check requires lastChange > 0, and a
    // boundary() sets lastChange = 0 (which forces the next change to start a
    // fresh step). Starting the clock non-zero keeps gap logic well-defined.
    clock.now = 1_000_000;
  });

  function setup() {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id)!;
    // Type a character with LOCAL_ORIGIN (like applyTextDiff)
    const type = (s: string) => {
      doc.transact(() => {
        text.insert(text.length, s);
      }, LOCAL_ORIGIN);
    };
    return { doc, undo, id, text, type };
  }

  // TC-12: keystrokes 100 ms apart between two boundary() calls → one step;
  // undo removes the whole burst
  it('TC-12: typing 100ms apart merges into a single undo step', () => {
    const { doc, undo, text, type } = setup();

    undo.boundary();
    type('a');
    clock.now += 100;
    type('b');
    clock.now += 100;
    type('c');
    undo.boundary();

    // Two steps total: the note creation, then the whole burst
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // The burst was one step: the next undo removes the creation itself
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13: pause of exactly UNDO_CAPTURE_TIMEOUT_MS → two steps;
  // UNDO_CAPTURE_TIMEOUT_MS − 1 ms → one step (boundary values)
  it('TC-13: pause of exactly the capture timeout splits; one ms less merges', () => {
    // Exactly UNDO_CAPTURE_TIMEOUT_MS → two typing steps
    {
      const { doc, undo, text, type } = setup();
      undo.boundary();
      type('a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS;
      type('b');
      undo.boundary();

      // Steps: creation, 'a', 'b'
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('a');
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('');
      expect(undo.undo()).toBe(true); // creation
      expect(snapshot(doc)).toHaveLength(0);
      expect(undo.canUndo()).toBe(false);
    }

    // UNDO_CAPTURE_TIMEOUT_MS − 1 ms → one merged typing step
    {
      const { doc, undo, text, type } = setup();
      undo.boundary();
      type('a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
      type('b');
      undo.boundary();

      // Steps: creation, 'ab'
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('');
      expect(undo.undo()).toBe(true); // creation
      expect(snapshot(doc)).toHaveLength(0);
      expect(undo.canUndo()).toBe(false);
    }
  });

  // Error path: boundary() on an empty stack is a no-op
  it('boundary() on an empty stack is a no-op', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
    doc.destroy();
  });
});
