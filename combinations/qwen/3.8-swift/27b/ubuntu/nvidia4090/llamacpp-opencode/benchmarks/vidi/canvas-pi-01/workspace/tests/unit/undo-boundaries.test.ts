// undo.boundaries — typing bursts (story 8): TC-12, TC-13.
//
// Typing that continues without a pause of UNDO_CAPTURE_TIMEOUT_MS (500 ms)
// is one undo step; a pause of exactly the timeout starts a new one.
// Yjs reads the clock via `time.getUnixTime` from lib0, so the module is
// mocked with a controllable clock and the boundary values are exact.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as time from 'lib0/time';
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  const state = { now: 1_000_000 };
  return {
    ...actual,
    getUnixTime: () => state.now,
    __state: state,
  };
});

const clock: { now: number } = (time as unknown as { __state: { now: number } }).__state;

/** Insert `text` into the note's Y.Text with a LOCAL_ORIGIN transaction. */
function typeIn(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id);
  if (ytext === undefined) throw new Error(`no text on ${id}`);
  doc.transact(() => ytext.insert(ytext.length, text), LOCAL_ORIGIN);
}

function textOf(doc: Y.Doc, id: string): string {
  const ytext = getStickyText(doc, id);
  if (ytext === undefined) throw new Error(`no text on ${id}`);
  return ytext.toString();
}

describe('undo.boundaries — typing bursts', () => {
  it('TC-12 keystrokes 100 ms apart between boundaries are exactly one step', () => {
    clock.now = 1_000_000;
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    undo.boundary();

    typeIn(doc, id, 'a');
    clock.now += 100;
    typeIn(doc, id, 'b');
    clock.now += 100;
    typeIn(doc, id, 'c');
    undo.boundary();

    // One undo removes the whole burst.
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('');
    // The earlier creation step is still there (typing was a single step).
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(doc.getMap('objects').get(id)).toBeUndefined();
  });

  it(`TC-13 pause of exactly ${UNDO_CAPTURE_TIMEOUT_MS} ms starts a new step; ${UNDO_CAPTURE_TIMEOUT_MS - 1} ms does not`, () => {
    // Exactly UNDO_CAPTURE_TIMEOUT_MS between inserts → two steps.
    {
      clock.now = 2_000_000;
      const doc = new Y.Doc();
      initDoc(doc);
      const undo = createUndo(doc);
      const id = createSticky(doc, { x: 100, y: 100 });
      undo.boundary();

      typeIn(doc, id, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS;
      typeIn(doc, id, 'b');
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(textOf(doc, id)).toBe('a'); // only the second burst undone
      expect(undo.undo()).toBe(true);
      expect(textOf(doc, id)).toBe(''); // second step: the first burst
    }
    // UNDO_CAPTURE_TIMEOUT_MS − 1 ms between inserts → one step.
    {
      clock.now = 3_000_000;
      const doc = new Y.Doc();
      initDoc(doc);
      const undo = createUndo(doc);
      const id = createSticky(doc, { x: 100, y: 100 });
      undo.boundary();

      typeIn(doc, id, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
      typeIn(doc, id, 'b');
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(textOf(doc, id)).toBe(''); // both inserts gone in one step
      expect(undo.canUndo()).toBe(true); // the creation step remains
      expect(undo.undo()).toBe(true);
      expect(doc.getMap('objects').get(id)).toBeUndefined();
    }
  });

  it('boundary() on an empty stack is a no-op', () => {
    clock.now = 4_000_000;
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});
