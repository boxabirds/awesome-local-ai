/**
 * TC-12 and TC-13 (`undo.capture`) — where one step ends and the next begins.
 *
 * `Y.UndoManager` joins changes that follow one another within `captureTimeout`
 * — which is what makes the thirty frames of one drag, and the letters of one
 * word, a single step — and `boundary()` closes a window early, which is the
 * wall between two actions that merely happened to be quick after each other.
 *
 * Time is faked, and installed in an unusual order: yjs reads the clock once,
 * when it loads (`export const getUnixTime = Date.now` in lib0/time keeps a
 * reference to whatever `Date.now` happens to be at that moment), so the fake
 * clock is installed for the whole file and yjs is loaded inside it. One clock,
 * one yjs: with a clock per test the history would keep reading a stopped one,
 * and every boundary would look like a merge. The board modules are therefore
 * loaded in `beforeAll`, not imported at the top.
 *
 * Every case also starts from a note that existed before the history did, so
 * "one step" can be asserted exactly — `canUndo()` false after one undo — rather
 * than approximately.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import type * as Model from '../../src/shared/board-model';
import type { UndoController } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

interface Board {
  readonly doc: Y.Doc;
  readonly id: string;
  readonly undo: UndoController;
}

let model: typeof Model;
let createUndo: typeof import('../../src/client/board/undo').createUndo;
let Yjs: typeof Y;

beforeAll(async () => {
  // The clock first, the board second: see the file comment.
  vi.useFakeTimers();
  const loaded = await Promise.all([
    import('yjs'),
    import('../../src/shared/board-model'),
    import('../../src/client/board/undo'),
  ]);
  [Yjs, model, { createUndo }] = loaded;
});

afterAll(() => {
  vi.useRealTimers();
});

/** A board with one note on it, and no history of anybody's work. */
function boardWithNote(): Board {
  const doc = new Yjs.Doc();
  model.initDoc(doc);
  const id = model.createSticky(doc, { x: 200, y: 200 });
  if (typeof id !== 'string') throw new Error('the board under test refused a note');
  return { doc, id, undo: createUndo(doc) };
}

const textOf = (board: Board): string =>
  model.getStickyText(board.doc, board.id)?.toString() ?? '';

/** Typing, as the editor does it: one local transaction per keystroke event. */
function keystroke(board: Board, at: number, char: string): void {
  board.doc.transact(
    () => model.getStickyText(board.doc, board.id)?.insert(at, char),
    model.LOCAL_ORIGIN,
  );
}

/** Move `ms` of board time, without spending any real ones. */
function wait(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe('undo.capture', () => {
  it('TC-12: keystrokes inside one capture window are one undo step', () => {
    const board = boardWithNote();
    const { undo } = board;
    expect(undo.canUndo()).toBe(false); // the note itself is not my history

    undo.boundary();
    let typed = 0;
    for (const char of 'hello') {
      keystroke(board, typed, char);
      typed += 1;
      wait(100); // 100ms between keystrokes: comfortably inside the window
    }
    undo.boundary();

    expect(textOf(board)).toBe('hello');
    expect(undo.undo()).toBe(true);
    expect(textOf(board)).toBe('');
    // Five letters, one step.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false); // error path: nothing else to undo
    undo.destroy();
  });

  it('TC-13: changes a full capture timeout apart are separate steps', () => {
    const board = boardWithNote();
    const { undo } = board;

    keystroke(board, 0, 'o');
    wait(UNDO_CAPTURE_TIMEOUT_MS); // exactly the window wide: no longer inside it
    keystroke(board, 1, 't');

    expect(textOf(board)).toBe('ot');
    expect(undo.undo()).toBe(true);
    expect(textOf(board)).toBe('o'); // the later change alone
    expect(undo.undo()).toBe(true);
    expect(textOf(board)).toBe(''); // the earlier one, on its own
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('TC-13: one millisecond short of the window, they are one step again', () => {
    const board = boardWithNote();
    const { undo } = board;

    keystroke(board, 0, 'o');
    wait(UNDO_CAPTURE_TIMEOUT_MS - 1); // still inside the window
    keystroke(board, 1, 't');

    expect(undo.undo()).toBe(true);
    expect(textOf(board)).toBe(''); // both letters went together
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('TC-12/TC-13 (error path): boundaries with nothing to capture change nothing', () => {
    const board = boardWithNote();
    const { undo } = board;

    // A zero-length text edit: opened and closed, three times over, and no step.
    for (let round = 0; round < 3; round += 1) {
      undo.boundary();
      undo.boundary();
      wait(UNDO_CAPTURE_TIMEOUT_MS * 2);
    }
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(textOf(board)).toBe('');
    expect(model.objectSnapshots(board.doc)).toHaveLength(1);
    undo.destroy();
  });

  it('TC-14/TC-15 at the model: a drag is one step, and the gesture after it is another', () => {
    const board = boardWithNote();
    const { doc, id, undo } = board;
    const start = model.objectSnapshots(doc)[0]!;

    // 30 frames 16ms apart, exactly as a drag writes them, with one boundary
    // either side.
    undo.boundary();
    for (let frame = 1; frame <= 30; frame += 1) {
      model.moveObject(doc, id, start.x + frame * 4, start.y);
      wait(16);
    }
    undo.boundary();

    // Straight after the drag, another gesture: a step of its own, because the
    // boundary closed the drag's capture window even though less than a window
    // has gone by since.
    model.moveObject(doc, id, start.x + 900, start.y);

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    // Only the later gesture went back: the board is where the drag left it.
    expect(model.objectSnapshots(doc)[0]?.x).toBe(start.x + 30 * 4);
    expect(undo.undo()).toBe(true);
    // And the drag went as one piece, back to where it started.
    expect(model.objectSnapshots(doc)[0]).toMatchObject({ x: start.x, y: start.y });
    expect(undo.canUndo()).toBe(false); // two gestures, two steps
    undo.destroy();
  });
});
