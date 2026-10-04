import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Undo steps are cut out of transactions by a clock: changes close together in time are one
 * action, changes far apart are separate ones, and `boundary()` is the board saying "what happens
 * next is a different action". This file is about that cutting.
 *
 * The window is real time, so the waits below are real too. They are only ever waits in the
 * direction that cannot be spoiled by a slow machine: pause past the window and the step is split,
 * and the tests that expect things to merge simply do not pause at all.
 *
 * The two specification tests use the window the product ships with. The others choose a window of
 * their own - short enough to see a gesture cross one, or long enough that only a `boundary()` can
 * split anything - because what they are testing is how the window and the boundary interact, and
 * a test should not have to wait half a second per assertion to find out.
 */

/** Let more than a capture window go by. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, UNDO_CAPTURE_TIMEOUT_MS + 150);
  });
}

/** Let more than `times` capture windows of `ms` each go by. */
function wait(ms: number, times = 1): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms * times);
  });
}

/** A board with notes on it that predate the history, and a history over my own changes. */
interface Board {
  doc: Y.Doc;
  undo: UndoController;
  ids: string[];
  note(id?: string): ObjectSnapshot;
  text(id?: string): string;
  notes(): number;
}

function board(count = 1, captureTimeoutMs?: number): Board {
  const doc = new Y.Doc();
  initDoc(doc);
  // The notes are put down before the history is opened, so that whatever a test counts as steps
  // is only what the test itself did.
  const ids = Array.from({ length: count }, (_, i) => createSticky(doc, { x: i * 300, y: 0 }));
  const first = ids[0] as string;
  return {
    doc,
    undo: createUndo(doc, captureTimeoutMs === undefined ? {} : { captureTimeoutMs }),
    ids,
    note: (id = first) => snapshot(doc).find((n) => n.id === id) as ObjectSnapshot,
    text: (id = first) => getStickyText(doc, id)?.toString() ?? '',
    notes: () => snapshot(doc).length,
  };
}

/** Type into a note one keystroke at a time, the way the note's editor writes. */
function type(on: Board, text: string, id?: string): void {
  const ytext = getStickyText(on.doc, id ?? (on.ids[0] as string));
  if (!ytext) {
    throw new Error('the note has no text to type into');
  }
  for (const char of text) {
    on.doc.transact(() => {
      ytext.insert(ytext.length, char);
    }, LOCAL_ORIGIN);
  }
}

/**
 * How many steps the history holds, by taking them all.
 *
 * The number of steps is not exposed on purpose - a controller says whether it can undo, not how
 * much it remembers - so the way to count steps is to take them. Where a test cares about *which*
 * step comes next it undoes once and looks at the board instead.
 */
function steps(on: Board): number {
  let count = 0;
  while (on.undo.undo()) {
    count += 1;
    if (count > 60) {
      throw new Error('undo never ran out: the stack is not being drained');
    }
  }
  return count;
}

describe('undo step boundaries (TC-12, TC-13)', () => {
  it('TC-12 turns a run of typing into one step', async () => {
    const on = board();
    // Ten keystrokes without a pause a program could see: nobody takes half a second over a
    // character, so all ten land inside one capture window.
    type(on, 'hello worl');
    expect(on.text()).toBe('hello worl');
    // The pause at the end of a thought, longer than the window.
    await settle();

    // One undo, and the note is empty. Nobody wants to press undo once per letter to take a word
    // back, and a note left half-finished is not the state anybody meant to be in.
    expect(on.undo.undo()).toBe(true);
    expect(on.text()).toBe('');
    expect(steps(on)).toBe(0);
  });

  it('TC-13 splits typing into two steps when it pauses for longer than the window', async () => {
    const on = board();
    type(on, 'first');
    // Longer than the capture window: what is typed after it is a separate action, so undoing it
    // must not take the part before the pause with it.
    await settle();
    type(on, 'second');

    expect(on.text()).toBe('firstsecond');
    expect(on.undo.undo()).toBe(true);
    expect(on.text()).toBe('first');
    expect(on.undo.undo()).toBe(true);
    expect(on.text()).toBe('');
    expect(steps(on)).toBe(0);
  });

  it('keeps a drag in one step however long it lasts', async () => {
    // Sixty frames, each closer to the one before it than the window is, which is what a drag at
    // frame rate means: the whole movement is one action, and it is one action because the changes
    // never stop long enough for the clock to call them two.
    const on = board(1, 20);
    on.undo.boundary();
    for (let frame = 1; frame <= 60; frame += 1) {
      moveObject(on.doc, on.ids[0] as string, frame * 4, frame * 2);
      await wait(5);
    }
    on.undo.boundary();
    expect(on.note()).toMatchObject({ x: 240, y: 120 });

    expect(steps(on)).toBe(1);
    expect(on.note()).toMatchObject({ x: -100, y: -100 });
  });

  it('separates a drag from the keystrokes before it', async () => {
    // A window long enough that the clock would not split anything by itself, so whatever step is
    // here was put there by a boundary: typing, then the editor closing, then a drag.
    const on = board(1, 60_000);
    type(on, 'typed');
    on.undo.boundary();
    for (let frame = 1; frame <= 6; frame += 1) {
      moveObject(on.doc, on.ids[0] as string, frame * 40, frame * 20);
    }
    on.undo.boundary();

    // Two steps, and the drag is the one that goes first: undo takes back the last thing, which is
    // where the note is, not the words on it as well.
    expect(on.undo.undo()).toBe(true);
    expect(on.note()).toMatchObject({ x: -100, y: -100 });
    expect(on.text()).toBe('typed');
    expect(steps(on)).toBe(1);
  });

  it('joins a drag to the keystrokes before it when nobody drew a boundary', async () => {
    // The same typing and the same drag, without the boundary between them: one step, because the
    // clock cannot tell that a note's editor was open in between and then closed. One press of
    // undo now takes the words and the movement back together, which is the thing the editor's
    // exit and the end of a gesture each call `boundary()` to stop.
    const on = board(1, 60_000);
    type(on, 'typed');
    for (let frame = 1; frame <= 6; frame += 1) {
      moveObject(on.doc, on.ids[0] as string, frame * 40, frame * 20);
    }

    expect(on.undo.undo()).toBe(true);
    expect(on.note()).toMatchObject({ x: -100, y: -100 });
    expect(on.text()).toBe('');
    expect(steps(on)).toBe(0);
  });

  it('keeps typing and then moving apart as two steps', async () => {
    const on = board();
    type(on, 'note text');
    // A separate action, not a continuation: which is what the note's editor being opened and then
    // closed amounts to in time.
    await settle();
    moveObject(on.doc, on.ids[0] as string, 400, 300);

    // The move goes first and the text stays: undoing where a note is does not untype what is
    // written on it.
    expect(on.undo.undo()).toBe(true);
    expect(on.note()).toMatchObject({ x: -100, y: -100 });
    expect(on.text()).toBe('note text');

    expect(on.undo.undo()).toBe(true);
    expect(on.text()).toBe('');
    expect(steps(on)).toBe(0);
  });

  it('makes one step out of deleting a batch', () => {
    const on = board(6);
    // One transaction for all six, which is what a batch delete writes.
    on.undo.boundary();
    expect(deleteObjects(on.doc, on.ids)).toBe(6);
    on.undo.boundary();
    expect(on.notes()).toBe(0);

    expect(on.undo.undo()).toBe(true);
    // Six notes back from one press, and nothing left to press: the delete was one action, and
    // undo does not make six presses out of it.
    expect(on.notes()).toBe(6);
    expect(on.undo.canUndo()).toBe(false);
  });

  it('makes one step out of a resize gesture', () => {
    // A resize writes the same few fields every frame, at frame rate. Frames closer together than
    // the window make one step; the boundary at the start is what keeps the step from reaching back
    // over whatever the note's editor was doing before the handle was grabbed.
    const on = board(1, 20);
    type(on, 'typed');
    const start = on.note();
    on.undo.boundary();
    for (let frame = 1; frame <= 40; frame += 1) {
      resizeObjects(
        on.doc,
        new Map([
          [
            on.ids[0] as string,
            { x: start.x, y: start.y, width: 200 + frame * 5, height: 200 + frame * 3 },
          ],
        ]),
      );
    }
    on.undo.boundary();
    expect(on.note()).toMatchObject({ width: 400, height: 320 });

    expect(on.undo.undo()).toBe(true);
    expect(on.note()).toEqual(start);
    expect(on.text()).toBe('typed');
    expect(steps(on)).toBe(1);
  });

  it('makes a step of its own out of whatever the boundary separates', () => {
    // Two changes with nothing but a boundary between them: no time need pass, which is the whole
    // reason the board calls `boundary()` at the ends of gestures instead of trusting the clock to
    // have drifted far enough.
    const on = board(1, 60_000);
    moveObject(on.doc, on.ids[0] as string, 300, 300);
    on.undo.boundary();
    moveObject(on.doc, on.ids[0] as string, 600, 600);
    on.undo.boundary();

    expect(steps(on)).toBe(2);
  });
});
