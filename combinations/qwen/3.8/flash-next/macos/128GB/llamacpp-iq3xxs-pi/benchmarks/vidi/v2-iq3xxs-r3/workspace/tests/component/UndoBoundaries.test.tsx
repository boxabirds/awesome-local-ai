/**
 * TC-14, TC-15, TC-16, TC-17 (story 8, `undo.capture`) — how wide one undo step
 * is on a board a person is actually working on.
 *
 * Everything in these tests is the app's own: the note is drawn by the board,
 * the drag is `useTransformGesture` driven by pointer events, the typing goes
 * through the real editor, the colour comes from the note's own toolbar. The one
 * thing the test holds is the history (`renderStickyBoard({ undo })`), because
 * the assertion is about *how many steps the board put into it* — and a step is
 * only visible from there. The history is the real `createUndo`, not a fake:
 * a fake could report a count, but it could not show that the note is back where
 * it started.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { Doc } from 'yjs';

import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import {
  addNote,
  centreOfNote,
  dispatchKey,
  drag,
  flushFrame,
  noteById,
  pointerEvent,
  press,
  readNote,
  releaseAt,
  renderStickyBoard,
  setCamera,
  textOf,
} from './helpers/board';

/** The histories this file created, so their observers go with the board. */
const created: UndoController[] = [];

/** The board, with its history in the test's hands and the camera parked. */
function startBoard(): { doc: Doc; undo: UndoController } {
  const doc = new Doc();
  const undo = createUndo(doc);
  created.push(undo);
  renderStickyBoard(doc, { undo });
  act(() => setCamera({ x: 0, y: 0, zoom: 1 }));
  // Nothing was made here: every note below was seeded through the model with no
  // transaction origin, so the board starts with an empty history to fill.
  expect(undo.canUndo()).toBe(false);
  return { doc, undo };
}

afterEach(() => {
  cleanup();
  created.length = 0;
});

/** A gesture told frame by frame: `frames` pointer moves, one animation frame each. */
async function dragInFrames(doc: Doc, id: string, frames: number, step: number): Promise<void> {
  const from = centreOfNote(doc, id);
  press(noteById(id), from);
  for (let frame = 1; frame <= frames; frame += 1) {
    pointerEvent('pointerMove', noteById(id), { x: from.x + frame * step, y: from.y });
    await flushFrame();
  }
  releaseAt(noteById(id), { x: from.x + frames * step, y: from.y });
  await flushFrame();
}

/** Undo one step, with the document's own change heard by React. */
function undoStep(undo: UndoController): boolean {
  let applied = false;
  act(() => {
    applied = undo.undo();
  });
  return applied;
}

describe('what one undo step holds (undo.capture)', () => {
  /** TC-14: thirty writes, one step, and it goes back to before the gesture. */
  it('TC-14 a 30-frame drag is one step that restores where the drag began', async () => {
    const { doc, undo } = startBoard();
    const id = addNote(doc, { x: 200, y: 200 });
    const start = readNote(doc, id)!;

    await dragInFrames(doc, id, 30, 8);

    const moved = readNote(doc, id)!;
    expect(moved.x).toBeCloseTo(start.x + 240, 6);
    expect(undo.canUndo()).toBe(true);

    expect(undoStep(undo)).toBe(true);
    const back = readNote(doc, id)!;
    expect(back.x).toBeCloseTo(start.x, 6);
    expect(back.y).toBeCloseTo(start.y, 6);
    // One gesture, one step: the other 29 frames are inside it, not after it.
    expect(undo.canUndo()).toBe(false);
  });

  /**
   * TC-15: a drag and a colour change, seconds apart on a person's clock and
   * inside one capture window on the machine's — the boundary the gesture closed
   * with is what keeps them apart.
   */
  it('TC-15 a move and then a colour inside the capture window are two separate steps', async () => {
    const { doc, undo } = startBoard();
    const id = addNote(doc, { x: 150, y: 150 });
    const start = readNote(doc, id)!;

    drag(noteById(id), centreOfNote(doc, id), { x: 40, y: 0 });
    await flushFrame();
    // Still selected, so its toolbar is up, and the clock has not run out.
    fireEvent.click(screen.getByTestId('swatch-pink'));
    await flushFrame();

    const moved = readNote(doc, id)!;
    expect(moved.color).toBe('pink');
    expect(moved.x).toBeCloseTo(start.x + 40, 6);

    expect(undoStep(undo)).toBe(true);
    const recoloured = readNote(doc, id)!;
    expect(recoloured.color).toBe('yellow');
    // The move is still standing: only the colour came back.
    expect(recoloured.x).toBeCloseTo(start.x + 40, 6);

    expect(undoStep(undo)).toBe(true);
    expect(readNote(doc, id)!.x).toBeCloseTo(start.x, 6);
    expect(undo.canUndo()).toBe(false);
  });

  /**
   * TC-16: the history is one thing, and it does not care that the keystrokes
   * came from inside a note. Undo takes the typing, and the drag before it is
   * untouched — and the textarea shows what the document decided, not what the
   * browser remembers.
   */
  it('TC-16 Ctrl+Z typed inside a note undoes the typing and leaves the earlier move alone', async () => {
    const { doc, undo } = startBoard();
    const id = addNote(doc, { x: 200, y: 200 });
    const start = readNote(doc, id)!;

    drag(noteById(id), centreOfNote(doc, id), { x: 60, y: 0 });
    await flushFrame();
    const moved = readNote(doc, id)!;
    expect(moved.x).toBeCloseTo(start.x + 60, 6);

    fireEvent.doubleClick(noteById(id));
    const textarea = screen.getByTestId('sticky-textarea');
    fireEvent.change(textarea, { target: { value: 'a typed sentence' } });
    expect(textOf(doc, id)).toBe('a typed sentence');

    const event = dispatchKey({ key: 'z', ctrlKey: true }, textarea);
    // The editor answered it; the browser's own undo never got the chance.
    expect(event.defaultPrevented).toBe(true);

    expect(textOf(doc, id)).toBe('');
    expect((screen.getByTestId('sticky-textarea') as HTMLTextAreaElement).value).toBe('');
    // The move is not gone, and it is the next thing this person can take back.
    expect(readNote(doc, id)!.x).toBeCloseTo(start.x + 60, 6);
    expect(undo.canUndo()).toBe(true);

    expect(undoStep(undo)).toBe(true);
    expect(readNote(doc, id)!.x).toBeCloseTo(start.x, 6);
    expect(undo.canUndo()).toBe(false);
  });

  /**
   * TC-17: a gesture the browser took away half way through. Its last applied
   * frame stays on the board (story 2's TC-21) and the step it wrote stays too —
   * one step, back to where the pointer was pressed.
   */
  it('TC-17 a pointercancel in the middle of a drag leaves one step restoring the start', async () => {
    const { doc, undo } = startBoard();
    const id = addNote(doc, { x: 250, y: 120 });
    const start = readNote(doc, id)!;
    const from = centreOfNote(doc, id);

    press(noteById(id), from);
    for (let frame = 1; frame <= 10; frame += 1) {
      pointerEvent('pointerMove', noteById(id), { x: from.x + frame * 10, y: from.y });
      await flushFrame();
    }
    const interrupted = readNote(doc, id)!;
    expect(interrupted.x).toBeCloseTo(start.x + 100, 6);

    pointerEvent('pointerCancel', noteById(id), { x: from.x + 300, y: from.y });
    await flushFrame();

    // Interrupting a gesture is not undoing it: the position stays, the step stays.
    expect(readNote(doc, id)!.x).toBeCloseTo(start.x + 100, 6);
    expect(undo.canUndo()).toBe(true);

    expect(undoStep(undo)).toBe(true);
    expect(readNote(doc, id)!.x).toBeCloseTo(start.x, 6);
    expect(undo.canUndo()).toBe(false);
  });
});
