// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import {
  createNote,
  dragNote,
  editorElement,
  flushFrames,
  getStickyTextFor,
  notePosition,
  readCamera,
  renderBoard,
  selectNote,
  startEditingNote,
  swatchButton,
} from './fixtures/board';
import {
  BOX_SEED,
  clickObject,
  dragHandle,
  dragObject,
  objectCentreOnScreen,
  objectElement,
  objectRect,
  pointerCancelOn,
  pointerDownOn,
  pointerMoveOn,
  pressBoardKey,
  seedBoxes,
  shiftClickObject,
  waitForSelected,
} from './fixtures/selection';

/**
 * Where one user action ends and the next begins (`undo.boundaries`), on the real board with
 * the real history behind it.
 *
 * Every case is the same shape: do something the way a person does — frames of a drag,
 * keystrokes in a note, a click on a swatch — press Ctrl+Z once, and ask which of it came
 * back. A drag of 30 frames is one step, a colour chosen 200 ms after it is another, and a
 * drag somebody cancelled never happened as far as the history is concerned.
 */

beforeEach(async () => {
  await renderBoard();
  expect(readCamera().zoom).toBe(1);
});

/** Where these objects are, in the order asked for, so a move is comparable. */
function positionsOf(ids: readonly string[]): Array<{ id: string; x: number; y: number }> {
  return ids.map((id) => {
    const rect = objectRect(id);
    return { id, x: rect.x, y: rect.y };
  });
}

/** Type into the open editor one character at a time, as a keyboard does. */
function typeEachChar(text: string): void {
  const editor = editorElement();
  if (!editor) throw new Error('no note is being edited');
  for (const char of text) {
    act(() => {
      editor.value += char;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

/** Press a key on one element and report whether it stopped the browser's own action. */
function pressKeyOn(
  element: Element,
  key: string,
  options: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrl ?? false,
    metaKey: options.meta ?? false,
    shiftKey: options.shift ?? false,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe('a gesture is one step (TC-14, TC-17)', () => {
  it('TC-14: one Ctrl+Z returns every object a 30-frame group drag moved to where it started', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);
    const before = positionsOf([a, b, c]);

    await dragObject(a, { x: 120, y: 90 }, { steps: 30 });

    // 30 frames of the gesture, all written, nothing undone yet.
    expect(positionsOf([a, b, c])).toEqual([
      { id: a, x: BOX_SEED[0].x + 120, y: BOX_SEED[0].y + 90 },
      { id: b, x: BOX_SEED[1].x + 120, y: BOX_SEED[1].y + 90 },
      { id: c, x: BOX_SEED[2].x, y: BOX_SEED[2].y },
    ]);
    expect(positionsOf([a, b, c])).not.toEqual(before);

    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);

    // One step back: both moved objects are home and the one that never moved is still
    // where it was.
    expect(positionsOf([a, b, c])).toEqual(before);

    // There was only the one step of dragging in it: the history did not run on past it.
    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(positionsOf([a, b, c])).toEqual(before);
  });

  it('TC-14: a resize by a handle is a step of its own, next to the move before it', async () => {
    const [a] = await seedBoxes([BOX_SEED[0]]);
    const start = objectRect(a);

    await dragObject(a, { x: 40, y: 0 }, { steps: 6 });
    await clickObject(a); // the handles belong to the selection
    await dragHandle('se', { x: 40, y: 30 }, { steps: 8 });
    const resized = objectRect(a);
    expect(resized.x).toBe(start.x + 40);
    expect(resized.y).toBe(start.y);
    // The drag is measured in screen pixels divided by zoom, so a grown box is only ever
    // within a whisker of the requested size; the undo below returns what was stored.
    expect(resized.width).toBeCloseTo(start.width + 40, 6);
    expect(resized.height).toBeCloseTo(start.height + 30, 6);

    // The resize goes first, and the width and height come back together with it.
    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(objectRect(a)).toEqual({ ...start, x: start.x + 40 });

    // …then the move, which is a step of its own.
    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(objectRect(a)).toEqual(start);
  });

  it('TC-17: a drag a pointercancel interrupted is still one step, back to before the press', async () => {
    const [a] = await seedBoxes([BOX_SEED[0]]);
    const start = objectRect(a);
    const element = objectElement(a);
    const from = objectCentreOnScreen(a);

    pointerDownOn(element, from);
    for (const step of [8, 20, 34, 50]) {
      pointerMoveOn(element, { x: from.x + step, y: from.y + step });
      await flushFrames();
    }
    // The board takes the pointer away mid-drag, as a browser does for a stolen gesture.
    pointerCancelOn(element, { x: from.x + 50, y: from.y + 50 });
    await flushFrames();

    const interrupted = objectRect(a);
    expect(interrupted).toEqual({ ...start, x: start.x + 50, y: start.y + 50 });

    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(objectRect(a)).toEqual(start);
  });
});

describe('the action after a gesture is another step (TC-15, TC-16)', () => {
  it('TC-15: a colour chosen 200 ms after a drag is a separate step from the drag', async () => {
    const id = createNote({ x: -100, y: -100 });
    const start = notePosition(id);

    await dragNote(id, { x: 80, y: 40 }, 12);
    const moved = notePosition(id);
    expect(moved.x).not.toBe(start.x);

    // Right after the drag — well inside the capture window — this person picks a colour.
    // The gesture closing its own step is the only thing that keeps the two apart.
    await selectNote(id);
    act(() => {
      swatchButton('blue').click();
    });
    expect(notePosition(id).color).toBe('blue');

    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(notePosition(id)).toMatchObject({ color: start.color, x: moved.x, y: moved.y });

    expect(await pressBoardKey('z', { ctrl: true })).toBe(true);
    expect(notePosition(id)).toMatchObject({ x: start.x, y: start.y });
  });

  it('TC-16: Ctrl+Z typed inside the note undoes the typing and leaves the move alone', async () => {
    const id = createNote({ x: -300, y: -200 });
    await dragNote(id, { x: 60, y: 20 }, 6);
    const moved = notePosition(id);

    await startEditingNote(id);
    const editor = editorElement();
    if (!editor) throw new Error('the note did not open for editing');
    // One burst of typing: five keystrokes nobody would call five mistakes.
    typeEachChar('hello');
    expect(getStickyTextFor(id)).toBe('hello');

    // The shortcut belongs to the note now, and the browser's own textarea undo is not
    // allowed to run behind the shared text's back.
    const prevented = pressKeyOn(editor, 'z', { ctrl: true });
    await flushFrames();
    expect(prevented).toBe(true);
    expect(getStickyTextFor(id)).toBe('');
    expect(editorElement()?.value).toBe('');

    // The move this note made before it was edited is untouched (negative).
    expect(notePosition(id)).toMatchObject({ x: moved.x, y: moved.y });
  });

  it('TC-16: a burst of typing is one step, so Ctrl+Shift+Z brings the whole word back', async () => {
    const id = createNote({ x: -300, y: 100 });
    await startEditingNote(id);
    const editor = editorElement();
    if (!editor) throw new Error('the note did not open for editing');
    typeEachChar('morning');
    expect(getStickyTextFor(id)).toBe('morning');

    expect(pressKeyOn(editor, 'z', { ctrl: true })).toBe(true);
    await flushFrames();
    expect(getStickyTextFor(id)).toBe('');

    expect(pressKeyOn(editor, 'z', { ctrl: true, shift: true })).toBe(true);
    await flushFrames();
    expect(getStickyTextFor(id)).toBe('morning');
    expect(editorElement()?.value).toBe('morning');
  });
});
