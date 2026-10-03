import { describe, expect, it } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import {
  boardDoc,
  clickNote,
  createNote,
  doubleClick,
  noteCount,
  noteEl,
  noteSelected,
  pointer,
  readCamera,
  renderBoard,
  surface,
  windowKey,
} from './helpers';

function noteLeftTop(id: string): { x: number; y: number } {
  const s = noteEl(id).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top) };
}

describe('sticky.interaction', () => {
  it('TC-18 press + release without moving selects and shows the toolbar', () => {
    renderBoard();
    const id = createNote(300, 300);
    expect(noteSelected(id)).toBe(false);

    clickNote(id);

    expect(noteSelected(id)).toBe(true);
    expect(within(noteEl(id)).queryByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-19 moving 2px (below threshold) selects but never moves the note', () => {
    renderBoard();
    const id = createNote(300, 300);
    const before = noteLeftTop(id);

    const el = noteEl(id);
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 2, 0); // < DRAG_THRESHOLD_PX
    pointer(el, 'pointerup', 2, 0);

    expect(DRAG_THRESHOLD_PX).toBe(3);
    expect(noteSelected(id)).toBe(true);
    expect(noteLeftTop(id)).toEqual(before); // moveObject never ran
  });

  it('TC-20 moving 3px drags the note and never pans the board', () => {
    renderBoard();
    const id = createNote(300, 300);
    const camBefore = readCamera();
    const before = noteLeftTop(id);

    const el = noteEl(id);
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 3, 0); // == threshold → drag
    pointer(el, 'pointerup', 3, 0);

    expect(noteLeftTop(id).x).toBe(before.x + 3); // moved by delta / zoom(1)
    expect(readCamera()).toEqual(camBefore); // board did not pan
  });

  it('TC-21 pointercancel during a drag keeps the last position and stays selected', () => {
    renderBoard();
    const id = createNote(300, 300);

    const el = noteEl(id);
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 40, 20);
    const atCancel = noteLeftTop(id);

    pointer(el, 'pointercancel', 40, 20);

    expect(atCancel).toEqual({ x: 200 + 40, y: 200 + 20 });
    expect(noteSelected(id)).toBe(true);
    expect(noteLeftTop(id)).toEqual(atCancel);
  });

  it('TC-22 clicking empty board space clears the selection and hides the toolbar', () => {
    renderBoard();
    const id = createNote(300, 300);
    clickNote(id);
    expect(noteSelected(id)).toBe(true);

    // Press + release on empty board space (the grid surface itself).
    pointer(surface(), 'pointerdown', 900, 700);
    pointer(surface(), 'pointerup', 900, 700);

    expect(noteSelected(id)).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25 Delete removes the selected note', () => {
    renderBoard();
    const id = createNote(300, 300);
    clickNote(id);
    windowKey('Delete');
    expect(noteCount()).toBe(0);
  });

  it('TC-25b Backspace removes the selected note', () => {
    renderBoard();
    const id = createNote(300, 300);
    clickNote(id);
    windowKey('Backspace');
    expect(noteCount()).toBe(0);
  });

  it('TC-35 double-clicking an existing note edits it and creates nothing new', () => {
    renderBoard();
    const id = createNote(300, 300);
    doubleClick(noteEl(id), 50, 50);

    expect(noteCount()).toBe(1);
    expect(within(noteEl(id)).queryByRole('textbox')).toBeTruthy();
    expect(noteSelected(id)).toBe(true);
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    renderBoard();
    windowKey('Enter');
    expect(noteCount()).toBe(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 a note deleted by the model mid-drag ends the drag without error', () => {
    renderBoard();
    const id = createNote(300, 300);
    const el = noteEl(id);
    pointer(el, 'pointerdown', 0, 0);
    pointer(el, 'pointermove', 30, 30);

    expect(() => {
      // Simulate a remote/other path deleting the note mid-drag.
      act(() => deleteObject(boardDoc(), id));
      pointer(el, 'pointermove', 60, 60);
      pointer(el, 'pointerup', 60, 60);
    }).not.toThrow();

    expect(noteCount()).toBe(0);
  });

  it('TC-37b a note deleted by the model mid-edit ends editing without re-creating it', () => {
    renderBoard();
    const id = createNote(300, 300);
    doubleClick(noteEl(id), 50, 50);
    expect(within(noteEl(id)).queryByRole('textbox')).toBeTruthy();

    expect(() => {
      act(() => deleteObject(boardDoc(), id));
    }).not.toThrow();

    expect(noteCount()).toBe(0);
    expect(screen.queryByTestId(`sticky-note-${id}`)).toBeNull();
    expect(snapshot(boardDoc()).some((n) => n.id === id)).toBe(false);
  });
});
