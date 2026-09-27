// Story 8, task 7: unit tests (TC-12, TC-13) for the capture window /
// boundary semantics (design: "UndoController"; anchor undo.steps).
//
// Test-first: these fail until createUndo (src/client/board/undo.ts) exists.
//
// Time control: Yjs' UndoManager measures the capture window with
// lib0/time's getUnixTime, which captures the Date.now function reference at
// import time (`export const getUnixTime = Date.now`) — vi.useFakeTimers()
// therefore cannot control it. We mock lib0/time with a deterministic
// virtual clock instead.

import { describe, expect, it, vi } from 'vitest';
import {
  createStickyAt,
  getStickyText,
  moveObject,
  snapshot,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import * as Y from 'yjs';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

const clock = vi.hoisted(() => ({ now: 1_000_000 }));

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return {
    ...actual,
    getUnixTime: (): number => clock.now,
  };
});

/** Advance the virtual clock. */
function advance(ms: number): void {
  clock.now += ms;
}

/** One keystroke's worth of change: append `ch` under LOCAL_ORIGIN. */
function typeChar(doc: Y.Doc, text: Y.Text, ch: string): void {
  doc.transact(() => {
    text.insert(text.length, ch);
  }, LOCAL_ORIGIN);
}

describe('story 8: undo capture window (undo.steps)', () => {
  it('TC-12: a burst of typing inside the window is one undo step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    undo.boundary();
    const id = createStickyAt(doc, 0, 0);
    // The app puts a boundary after note creation (createAtPoint) and at
    // edit start, so the typing burst that follows is its own step.
    undo.boundary();

    const text = getStickyText(doc, id)!;
    // Simulated typing burst: 12 keystrokes at 40 ms apart (440 ms total,
    // all inside the 500 ms window).
    for (let i = 0; i < 12; i++) {
      advance(40);
      typeChar(doc, text, 'a');
    }

    expect(text.toString()).toBe('a'.repeat(12));

    // One undo reverts the whole burst.
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // No second typing step: the note (created in an earlier, separate step)
    // survives the typing undo...
    expect(snapshot(doc)).toHaveLength(1);
    // ...and there is exactly one more step (the note creation).
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('TC-13: a change at captureTimeout ms after the last change is a new step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const id = createStickyAt(doc, 0, 0); // step 1 (note creation)
    expect(undo.canUndo()).toBe(true);

    const text = getStickyText(doc, id)!;
    typeChar(doc, text, 'x'); // merged into step 1 (well inside the window)

    // Exactly the window elapses between the last change and the next one:
    // merge requires gap < captureTimeout, so this is a new step.
    advance(UNDO_CAPTURE_TIMEOUT_MS);
    moveObject(doc, id, 50, 0); // step 2

    // Two distinct steps: two undos to reach the empty board.
    expect(undo.undo()).toBe(true); // move back
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0, text: 'x' });
    expect(undo.undo()).toBe(true); // creation (and merged typing) back
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('a change one ms before captureTimeout after the last change merges into the step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const id = createStickyAt(doc, 0, 0);
    undo.boundary(); // typing (and the move below) form their own step
    const text = getStickyText(doc, id)!;
    typeChar(doc, text, 'x');

    // One ms less than the window: still merges into the typing step.
    advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
    moveObject(doc, id, 50, 0);

    // One undo reverts both the move and the typing (single step).
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0, text: '' });
    expect(undo.undo()).toBe(true); // note creation
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });

  it('boundary() with no open window is a no-op and never adds a step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    expect(undo.boundary()).toBeUndefined();
    expect(undo.boundary()).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('boundary() closes the window: the next local change is its own step (undo.gesture)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);

    const id = createStickyAt(doc, 0, 0); // step 1
    undo.boundary();
    // Well inside the 500 ms window, but after an explicit boundary: a new step.
    advance(100);
    moveObject(doc, id, 10, 0); // step 2

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: 0, y: 0 });
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });
});
