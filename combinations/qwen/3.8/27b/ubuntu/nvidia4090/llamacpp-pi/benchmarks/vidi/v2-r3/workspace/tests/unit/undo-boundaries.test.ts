/**
 * Story 8 unit tests (undo.boundaries typing bursts, TC-12 to TC-13).
 *
 * Yjs measures the capture timeout with `lib0/time.getUnixTime`, which is a
 * reference to `Date.now` captured at import time — so fake timers installed
 * later (vi.useFakeTimers) cannot move its clock. Instead we mock the
 * `lib0/time` module with a controllable clock and drive it exactly, which is
 * what lets the 499 ms / 500 ms boundary be tested precisely.
 *
 * The sticky is seeded *before* the controller is created so the seed step is
 * not on the history: the assertions about "one step" then hold exactly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ t: 1_000_000_000 }));

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => clock.t };
});

import * as Y from 'yjs';
import {
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import { seedSticky } from './peer';

describe('undo.boundaries (typing bursts)', () => {
  beforeEach(() => {
    clock.t = 1_000_000_000;
  });

  it('TC-12: keystrokes 100 ms apart between two boundaries → one step; undo removes the whole burst', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const x = seedSticky(doc, { x: 0, y: 0 });
    const c = createUndo(doc);
    const t = getStickyText(doc, x);
    if (!t) throw new Error('no text type');

    c.boundary();
    for (const ch of ['h', 'e', 'l', 'l', 'o']) {
      doc.transact(() => t.insert(t.length, ch), LOCAL_ORIGIN);
      clock.t += 100; // each pause < UNDO_CAPTURE_TIMEOUT_MS
    }
    c.boundary(); // editing ends

    expect(c.undo()).toBe(true);
    expect(t.toString()).toBe(''); // the whole burst is one step
    expect(c.canUndo()).toBe(false);
  });

  it(`TC-13: pause of exactly ${UNDO_CAPTURE_TIMEOUT_MS} ms → two steps; ${UNDO_CAPTURE_TIMEOUT_MS - 1} ms → one step`, () => {
    // (a) Exactly the timeout: the burst ends, a new step starts.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const x = seedSticky(doc, { x: 0, y: 0 });
      const c = createUndo(doc);
      const t = getStickyText(doc, x);
      if (!t) throw new Error('no text type');

      c.boundary();
      doc.transact(() => t.insert(0, 'a'), LOCAL_ORIGIN);
      clock.t += UNDO_CAPTURE_TIMEOUT_MS;
      doc.transact(() => t.insert(t.length, 'b'), LOCAL_ORIGIN);
      c.boundary();

      expect(c.undo()).toBe(true);
      expect(t.toString()).toBe('a'); // only the second burst was undone
      expect(c.undo()).toBe(true);
      expect(t.toString()).toBe('');
      expect(c.canUndo()).toBe(false);
    }
    // (b) One millisecond less: still the same burst.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const x = seedSticky(doc, { x: 0, y: 0 });
      const c = createUndo(doc);
      const t = getStickyText(doc, x);
      if (!t) throw new Error('no text type');

      c.boundary();
      doc.transact(() => t.insert(0, 'a'), LOCAL_ORIGIN);
      clock.t += UNDO_CAPTURE_TIMEOUT_MS - 1;
      doc.transact(() => t.insert(t.length, 'b'), LOCAL_ORIGIN);
      c.boundary();

      expect(c.undo()).toBe(true);
      expect(t.toString()).toBe(''); // one step: both inserts removed
      expect(c.canUndo()).toBe(false);
    }
  });

  it('boundary() on an empty stack is a no-op (error path)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    expect(() => c.boundary()).not.toThrow();
    c.boundary();

    const x = seedSticky(doc, { x: 0, y: 0 });
    c.boundary();
    expect(c.undo()).toBe(true);
    expect(c.canUndo()).toBe(false);
  });
});
