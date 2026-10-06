/**
 * Undo step boundaries (TC-12, TC-13).
 *
 * The capture window is a comparison against `Date.now()`, and yjs captures that function by
 * reference when the module loads - a fake clock cannot move it. So these tests wait out real
 * intervals, placed clear on either side of `UNDO_CAPTURE_TIMEOUT_MS` (a quarter of a second
 * inside it, a quarter of a second outside) rather than on the exact millisecond, which nothing
 * in a browser could guarantee either. Both sides are enough to pin the window: a change 250 ms
 * inside it must merge, a change 250 ms outside it must not.
 */
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  setStickyColor,
  stickySnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

/** The margin used to sit clearly inside or outside the window. */
const MARGIN = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function noteOf(doc: Y.Doc, id: string) {
  return stickySnapshot(doc).find((note) => note.id === id);
}

/** A board with one fresh note, and the undo controller over it. */
async function setup(): Promise<{ doc: Y.Doc; id: string; text: Y.Text; undo: UndoController }> {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = createUndo(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const text = getStickyText(doc, id)!;
  // the creation is a step of its own, so what follows can only merge with itself
  undo.boundary();
  return { doc, id, text, undo };
}

/** Types one character into the note's shared text, the way the editor's beforeinput does. */
function typeChar(text: Y.Text, char: string): void {
  text.doc!.transact(() => text.insert(text.length, char), LOCAL_ORIGIN);
}

describe('undo.boundaries: typing bursts', () => {
  test('TC-12: keystrokes 100 ms apart are one step, and undo removes the whole burst', async () => {
    const { doc, id, text, undo } = await setup();

    for (const char of 'hello') {
      typeChar(text, char);
      await sleep(100);
    }
    expect(text.toString()).toBe('hello');

    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe(''); // the entire burst fell away at once
    expect(stickySnapshot(doc).map((note) => note.id)).toEqual([id]); // the note itself is untouched

    // and the step below it is the creation, still waiting
    expect(undo.undo()).toBe(true);
    expect(stickySnapshot(doc)).toHaveLength(0);
  });

  test('TC-13: a pause of UNDO_CAPTURE_TIMEOUT_MS - MARGIN stays one step', async () => {
    const { doc, id, undo } = await setup();

    setStickyColor(doc, id, 'pink');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS - MARGIN);
    setStickyColor(doc, id, 'green');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(noteOf(doc, id)!.color).toBe('yellow'); // both colours fell away together
  });

  test('TC-13: a pause of UNDO_CAPTURE_TIMEOUT_MS + MARGIN starts a new step', async () => {
    const { doc, id, undo } = await setup();

    setStickyColor(doc, id, 'pink');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS + MARGIN);
    setStickyColor(doc, id, 'green');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(noteOf(doc, id)!.color).toBe('pink'); // only the green fell away
    expect(undo.undo()).toBe(true);
    expect(noteOf(doc, id)!.color).toBe('yellow');
  });

  test('a boundary with an empty history does nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(() => undo.boundary()).not.toThrow();
  });
});
