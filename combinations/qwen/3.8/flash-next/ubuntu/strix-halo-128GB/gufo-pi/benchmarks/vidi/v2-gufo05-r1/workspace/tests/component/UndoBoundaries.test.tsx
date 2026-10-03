/**
 * How a stretch of activity counts as one thing to undo (TC-14, TC-15, TC-16, TC-17).
 *
 * These run the real app over a real document and press the app's own Undo button, because
 * what is under test is where the app opens and closes a step: a drag of thirty pointer
 * moves is one entry, a drag and a colour change are two, the typing in one note is an
 * entry of its own that never swallows the move before it — and is undone by the shortcut
 * pressed inside the field itself — and a drag cancelled at the window edge is still one
 * entry. Counting the steps can only be done through the app's
 * history, so nothing here builds a controller of its own.
 *
 * The 500ms capture window runs on real time and a frame here costs 25ms of it, which is
 * well inside a gesture. The exact edge of the window is TC-13, against an injected clock.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { getStickyText } from '../../src/shared/board-model';
import { worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  advanceFrames,
  renderStickyApp,
  type StickyAppHandle,
} from './stickyHarness';

/** Screen point for a world point, with the camera the board opens with. */
const at = (board: StickyAppHandle, world: Point) => worldToScreen(board.camera(), world);

/** Where the model says that note is (top-left). */
function place(board: StickyAppHandle, id: string): Point {
  const found = board.notes().find((note) => note.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return { x: found.x, y: found.y };
}

/** The rendered element of one object, whatever type it is. */
function elementOf(board: StickyAppHandle, id: string): HTMLElement {
  const element = board.objectElements().find((item) => item.dataset.objectId === id);
  if (!element) throw new Error(`object ${id} is not rendered`);
  return element;
}

const textOf = (board: StickyAppHandle, id: string): string =>
  getStickyText(board.doc, id)?.toString() ?? '';

/**
 * Press a key at a target and report whether anything claimed the event.
 *
 * Cancelable, because half of what a shortcut has to do is stop the browser doing its
 * own thing with the same keys.
 */
function pressKey(
  target: EventTarget,
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

/** Press the toolbar's Undo and let the board redraw. */
async function pressUndo(): Promise<void> {
  const undo = button('Undo');
  expect(undo.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(undo);
  });
  await advanceFrames(1);
}

/** Press a note, move it by a screen delta in `steps` steps, and let go. */
async function dragBy(
  board: StickyAppHandle,
  id: string,
  delta: Point,
  steps = 10,
): Promise<void> {
  const centre = place(board, id);
  const from = at(board, { x: centre.x + 100, y: centre.y + 100 });
  const element = elementOf(board, id);
  await board.press(element, from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    await board.moveTo(from.x + (delta.x * step) / steps, from.y + (delta.y * step) / steps);
  }
  await board.release(from.x + delta.x, from.y + delta.y);
}

describe('undo.steps: gestures, edits and clicks counted as steps', () => {
  it('TC-14 undoes a drag of many moves in one go', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    const start = place(board, id);

    await dragBy(board, id, { x: 240, y: 180 }, 30);
    expect(place(board, id)).toEqual({ x: start.x + 240, y: start.y + 180 });

    // One press, and the whole drag is gone: thirty writes, one step.
    await pressUndo();
    expect(place(board, id)).toEqual(start);
    expect(board.noteIds()).toEqual([id]);

    // The step under it is the creation, which is its own step and still there to undo.
    await pressUndo();
    expect(board.noteIds()).toEqual([]);
    expect(button('Undo').disabled).toBe(true);
  });

  it('TC-15 keeps a drag and a colour change as two steps', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    const start = place(board, id);

    await dragBy(board, id, { x: 150, y: 60 });
    const moved = place(board, id);
    expect(moved).toEqual({ x: start.x + 150, y: start.y + 60 });

    fireEvent.click(screen.getByRole('button', { name: 'Green colour' }));
    await advanceFrames(1);
    expect(board.notes().find((note) => note.id === id)!.color).toBe('green');

    // The colour goes back on its own; the note stays where it was dragged to.
    await pressUndo();
    expect(board.notes().find((note) => note.id === id)!.color).not.toBe('green');
    expect(place(board, id)).toEqual(moved);

    // Then the move, and then the creation: three steps, in the order they happened.
    await pressUndo();
    expect(place(board, id)).toEqual(start);
    await pressUndo();
    expect(board.noteIds()).toEqual([]);
    expect(button('Undo').disabled).toBe(true);
  });

  it('TC-16 undoes the typing in a note without touching the move before it', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    const start = place(board, id);

    await dragBy(board, id, { x: 100, y: 40 });
    const moved = place(board, id);
    expect(moved).toEqual({ x: start.x + 100, y: start.y + 40 });

    // Open the note, type five times, leave: the burst is one step of its own.
    const centre = at(board, { x: moved.x + 100, y: moved.y + 100 });
    await board.doubleClick(elementOf(board, id), centre.x, centre.y);
    for (const word of ['m', 'mo', 'mot', 'moti', 'motion']) {
      await board.type(word);
    }
    expect(textOf(board, id)).toBe('motion');

    // Ctrl+Z with the caret still in the field: the field's own undo would change what is
    // on this screen and nothing else, so the board claims the key. The word goes, and
    // the note stays where it was dragged to.
    expect(pressKey(board.textarea(), 'z', { ctrlKey: true })).toBe(true);
    await advanceFrames(1);
    expect(textOf(board, id)).toBe('');
    expect(place(board, id)).toEqual(moved);

    // Leave editing and press again: now it is the move that goes.
    await act(async () => {
      fireEvent.keyDown(board.textarea(), { key: 'Escape', bubbles: true });
    });
    await advanceFrames(1);
    await pressUndo();
    expect(place(board, id)).toEqual(start);
  });

  it('TC-17 makes a cancelled drag one step, which goes back to the start', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    const start = place(board, id);

    const from = at(board, { x: 100, y: 100 });
    await board.press(elementOf(board, id), from.x, from.y);
    await board.moveTo(from.x + 120, from.y + 90);
    await board.cancel();

    expect(place(board, id)).toEqual({ x: start.x + 120, y: start.y + 90 });

    // One press puts it back where the press began, and the note is still a note.
    await pressUndo();
    expect(place(board, id)).toEqual(start);
    expect(board.noteIds()).toEqual([id]);

    // Nothing else from that gesture is left in the history: the step under it is the
    // creation.
    await pressUndo();
    expect(board.noteIds()).toEqual([]);
  });
});
