/**
 * sticky.interaction component tests (TC-18 to TC-22, TC-25, TC-35 to TC-37).
 *
 * The whole app is rendered with a real Y.Doc, and the board is driven with pointer and
 * keyboard events, so the state machine (Unselected / Pressed / Selected / Dragging /
 * Editing) and the keyboard rules are exercised the way a user hits them. Pixel-accurate
 * dragging at other zoom levels is covered by the e2e suite.
 */
import { act, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, getCamera, runFrames } from './helpers';
import { bringToFront, createSticky, deleteObject, getStickyText, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';

const pointer = (clientX: number, clientY: number) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function notes(): readonly StickySnapshot[] {
  return window.__vidi6?.getNotes() ?? [];
}

function note(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
}

/** Creates a note through the model, exactly like the app does, and lets React render it. */
async function addNote(x: number, y: number): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  expect(id).not.toBe('');
  return id;
}

/** Press and release without moving: a click on the note. */
async function clickNote(id: string): Promise<void> {
  const element = note(id);
  fireEvent.pointerDown(element, pointer(300, 300));
  fireEvent.pointerUp(element, pointer(300, 300));
  await runFrames();
}

describe('sticky.interaction.select', () => {
  test('TC-18 a press and release without movement selects the note', async () => {
    renderBoard();
    const id = await addNote(0, 0);

    await clickNote(id);

    const element = note(id);
    expect(element).toHaveAttribute('data-selected', 'true');
    expect(element).toHaveAttribute('role', 'group');
    expect(element).toHaveAccessibleName('Sticky note');

    // the note toolbar appears, with named swatches and a named delete button
    const toolbar = within(element).getByTestId('note-toolbar');
    expect(toolbar).toBeInTheDocument();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(within(toolbar).getByLabelText(`${name} colour`)).toBeInTheDocument();
    }
    expect(within(toolbar).getByLabelText('Delete note')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Yellow colour')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('TC-19 moving 2 pixels is still a click: the note does not move', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    const before = notes().find((item) => item.id === id);

    const element = note(id);
    fireEvent.pointerDown(element, pointer(300, 300));
    fireEvent.pointerMove(element, pointer(300 + (DRAG_THRESHOLD_PX - 1), 300));
    fireEvent.pointerUp(element, pointer(300 + (DRAG_THRESHOLD_PX - 1), 300));
    await runFrames();

    const after = notes().find((item) => item.id === id);
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z); // bringToFront never ran either
    expect(note(id)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-20 moving to the threshold drags the note and never pans the board', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    const before = notes().find((item) => item.id === id);
    const cameraBefore = getCamera();

    const element = note(id);
    fireEvent.pointerDown(element, pointer(300, 300));
    fireEvent.pointerMove(element, pointer(300 + DRAG_THRESHOLD_PX, 300));
    await runFrames();

    expect(note(id)).toHaveAttribute('data-dragging', 'true');
    // the toolbar is hidden while dragging
    expect(within(note(id)).queryByTestId('note-toolbar')).toBeNull();
    // the position is written in world units: the screen delta divided by the zoom
    const moved = notes().find((item) => item.id === id);
    expect(moved?.x).toBeCloseTo((before?.x ?? 0) + DRAG_THRESHOLD_PX / cameraBefore.zoom, 6);
    expect(moved?.y).toBe(before?.y);

    fireEvent.pointerUp(note(id), pointer(300 + DRAG_THRESHOLD_PX, 300));
    await runFrames();

    // the board camera did not move by a single unit
    expect(getCamera()).toEqual(cameraBefore);
    const settled = notes().find((item) => item.id === id);
    expect(settled?.x).toBeCloseTo((before?.x ?? 0) + DRAG_THRESHOLD_PX / cameraBefore.zoom, 6);
    expect(note(id)).toHaveAttribute('data-selected', 'true');
    expect(note(id)).not.toHaveAttribute('data-dragging');
  });

  test('TC-21 a cancelled drag keeps the last position the note was shown at', async () => {
    renderBoard();
    const id = await addNote(0, 0);

    const element = note(id);
    fireEvent.pointerDown(element, pointer(300, 300));
    fireEvent.pointerMove(element, pointer(340, 320));
    await runFrames();
    const lastShown = notes().find((item) => item.id === id);
    expect(lastShown?.x).not.toBe(0);

    fireEvent.pointerMove(note(id), pointer(500, 500)); // never applied: cancelled first
    fireEvent.pointerCancel(note(id), pointer(500, 500));
    await runFrames();

    const after = notes().find((item) => item.id === id);
    expect(after?.x).toBe(lastShown?.x);
    expect(after?.y).toBe(lastShown?.y);
    expect(note(id)).toHaveAttribute('data-selected', 'true');
    expect(note(id)).not.toHaveAttribute('data-dragging');
  });

  test('TC-22 clicking empty board space clears the selection and the toolbar', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    await clickNote(id);
    expect(note(id)).toHaveAttribute('data-selected', 'true');

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, pointer(900, 700));
    fireEvent.pointerUp(viewport, pointer(900, 700));
    await runFrames();

    expect(note(id)).not.toHaveAttribute('data-selected');
    expect(within(note(id)).queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('sticky.interaction.delete', () => {
  test.each([['Delete'], ['Backspace']])('TC-25 a selected note is removed by %s', async (key) => {
    renderBoard();
    const keep = await addNote(0, 0);
    const gone = await addNote(400, 0);
    await clickNote(gone);

    dispatchKey(window, { key });
    await runFrames();

    expect(notes().map((item) => item.id)).toEqual([keep]);
  });

  test('TC-36 Enter with nothing selected creates and edits nothing', async () => {
    renderBoard();
    const id = await addNote(0, 0);

    dispatchKey(window, { key: 'Enter' });
    await runFrames();

    expect(notes()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(note(id)).not.toHaveAttribute('data-selected');
  });
});

describe('sticky.interaction.edit', () => {
  test('TC-35 double-clicking a note edits it instead of creating another one', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    await act(() => {
      getStickyText(doc(), id)?.insert(0, 'Faster onboarding');
    });

    fireEvent.doubleClick(note(id));
    await runFrames();

    expect(notes()).toHaveLength(1);
    const input = screen.getByTestId('sticky-note-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Faster onboarding');
    expect(note(id)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-37 a note deleted while dragging ends the drag quietly', async () => {
    renderBoard();
    const id = await addNote(0, 0);

    const element = note(id);
    fireEvent.pointerDown(element, pointer(300, 300));
    fireEvent.pointerMove(element, pointer(360, 340));
    await runFrames();

    // the note vanishes underneath the still-pressed pointer
    await act(() => {
      deleteObject(doc(), id);
    });
    fireEvent.pointerMove(noteOrBody(), pointer(420, 400));
    await runFrames();
    fireEvent.pointerUp(noteOrBody(), pointer(420, 400));
    await runFrames();

    expect(notes()).toHaveLength(0); // not recreated
  });

  test('TC-37 a note deleted while editing ends editing quietly', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    fireEvent.doubleClick(note(id));
    await runFrames();
    const input = screen.getByTestId('sticky-note-input');

    fireEvent.change(input, { target: { value: 'typing away' } });
    await runFrames();

    await act(() => {
      deleteObject(doc(), id);
    });
    await runFrames();

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    expect(notes()).toHaveLength(0);
    // and the keyboard is not stuck in "editing" mode: nothing is selected, nothing throws
    dispatchKey(window, { key: 'Delete' });
    await runFrames();
    expect(notes()).toHaveLength(0);
  });
});

/** The note element if it is still there, otherwise the viewport (deleted mid-drag). */
function noteOrBody(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-note-id]') ?? screen.getByTestId('board-viewport');
}

describe('sticky.interaction.stacking', () => {
  test('dragging a note brings it to the front', async () => {
    renderBoard();
    const bottom = await addNote(0, 0);
    const top = await addNote(60, 0);
    expect(notes().map((item) => item.id)).toEqual([bottom, top]);

    const element = note(bottom);
    fireEvent.pointerDown(element, pointer(300, 300));
    fireEvent.pointerMove(element, pointer(310, 310));
    await runFrames();

    expect(snapshot(doc()).map((item) => item.id)).toEqual([top, bottom]);
    expect(bringToFront(doc(), bottom)).toBe(false); // it is already the topmost note
  });

  test('a note is a square of the configured size in world units', async () => {
    renderBoard();
    const id = await addNote(0, 0);
    const style = note(id).style;
    expect(style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    // createSticky centres the note on the point it was given: (0,0) -> top-left (-100,-100)
    expect(style.left).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(style.top).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
  });
});
