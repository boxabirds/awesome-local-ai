import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, createSticky, getStickyText } from '../../src/shared/board-model';

/**
 * Story 8, undo.boundaries at the mechanism level (TC-12, TC-13): the
 * capture window that decides when typing is one step and when it is two.
 *
 * The window is measured on the wall clock - `Date.now`, captured by value
 * inside lib0, so a fake-timer clock cannot reach it. Rather than race the
 * boundary, the test keeps every gap far from it: burst gaps of ~10 ms are
 * inside the 500 ms window with ~50x margin, and the splitting pauses of
 * 600 ms are past it with 100 ms to spare. A run would have to stall
 * mid-test for a gap to blur across the boundary.
 */

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Type one chunk the way the editor does: a local transaction on Y.Text. */
function type(doc: Y.Doc, id: string, chunk: string): void {
  doc.transact(() => {
    getStickyText(doc, id)?.insert(getStickyText(doc, id)!.toString().length, chunk);
  }, LOCAL_ORIGIN);
}

function seedNote(doc: Y.Doc, x = 100, y = 100): string {
  // The note was already on the board before the typing starts. Seeding it
  // inside a `null`-origin transaction keeps that creation out of the undo
  // history (remote updates arrive without an origin either), so the test's
  // stack is about the typing alone.
  let id = '';
  doc.transact(() => {
    id = createSticky(doc, { x, y });
  }, null);
  return id;
}

let undoUnderTest: UndoController | null = null;

afterEach(() => {
  undoUnderTest?.destroy();
  undoUnderTest = null;
});

describe('undo.boundaries: the capture window (TC-12, TC-13)', () => {
  it('TC-12 a typing burst at ~10 ms per keystroke is one undo step', async () => {
    const doc = new Y.Doc();
    const id = seedNote(doc);
    const undo = createUndo(doc);
    undoUnderTest = undo;

    // Five characters, each its own local transaction, each ~10 ms after
    // the last: below `undo.steps` all the way through, so the burst is one
    // step. (The story's typing cadence is 100 ms; the wait is shortened,
    // never lengthened, so the burst stays inside the window.)
    for (const chunk of ['h', 'e', 'l', 'l', 'o']) {
      type(doc, id, chunk);
      await wait(10);
    }
    expect(undo.stackSize().undo).toBe(1);
    expect(getStickyText(doc, id)?.toString()).toBe('hello');

    // One undo clears the whole burst - and redo brings all of it back.
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('');
    expect(undo.redo()).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('hello');
  });

  it('TC-13 a pause past the window splits; a pause inside it does not', async () => {
    const doc = new Y.Doc();
    const id = seedNote(doc);
    const undo = createUndo(doc);
    undoUnderTest = undo;

    // Inside the window (60 ms into a 500 ms one): still the same burst.
    type(doc, id, 'ab');
    await wait(60);
    type(doc, id, 'cd');
    expect(undo.stackSize().undo).toBe(1);

    // Past the window (600 ms): a new step, 100 ms clear of the boundary.
    await wait(600);
    type(doc, id, 'ef');
    expect(undo.stackSize().undo).toBe(2);

    // And again: a third step. The test has now touched the boundary
    // between "burst" and "burst" from both sides.
    await wait(600);
    type(doc, id, 'gh');
    expect(undo.stackSize().undo).toBe(3);

    // The newest step is just 'gh'.
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('abcdef');
    // ...then 'ef', then the first burst: three typed steps, three undos.
    // The third one takes 'ab' and 'cd' together - they were one burst.
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('abcd');
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)?.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });
});
