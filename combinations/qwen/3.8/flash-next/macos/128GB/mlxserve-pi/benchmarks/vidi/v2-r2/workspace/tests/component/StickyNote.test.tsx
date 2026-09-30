// sticky.interaction (ui-component): pressing, dragging, stacking, selecting and
// deleting a note, against a real Y.Doc in jsdom.
//
// The board camera is read from the viewport's data attributes, so "the board did
// not pan" is an assertion about the same numbers the board renders with.

import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import {
  clickBoard,
  clickOn,
  dragNote,
  doubleClickOn,
  flushFrames,
  isEditing,
  newNote,
  noteAt,
  noteCount,
  noteElements,
  noteOrder,
  paintOrder,
  notePosition,
  noteToolbarOpen,
  pointerOn,
  pressKey,
  readCamera,
  renderBoard,
  selectionCount,
  useBoardTestLifecycle,
} from './helpers';

describe('sticky note interaction', () => {
  useBoardTestLifecycle();

  it('TC-18 presses and releases without moving: the note is selected, outlined and shows its tools', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });

    clickOn(noteAt(0));

    expect(selectionCount()).toBe(1);
    expect(noteAt(0).dataset.selected).toBe('true');
    expect(noteToolbarOpen()).toBe(true);
    // the name a screen reader reads out, and keyboard reachability
    expect(noteAt(0).getAttribute('aria-label')).toBe('Sticky note');
    expect(noteAt(0).getAttribute('role')).toBe('group');
    expect(noteAt(0).getAttribute('tabindex')).toBe('0');
    expect(id).not.toBe('');
  });

  it('TC-19 moves 2px, under the drag threshold: still a click, the note did not move', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 40, y: 60 });
    const before = notePosition(0);

    const el = noteAt(0);
    pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(el, 'pointermove', { clientX: 12, clientY: 10 });
    flushFrames();
    expect(notePosition(0)).toEqual(before);
    pointerOn(el, 'pointerup', { clientX: 12, clientY: 10 });
    flushFrames();

    expect(notePosition(0)).toEqual(before);
    expect(selectionCount()).toBe(1);
    expect(noteAt(0).dataset.dragging).toBe('false');
  });

  it('TC-20 moves exactly the threshold: the drag starts and the board does not pan', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const cameraBefore = readCamera();
    const start = notePosition(0);

    const el = noteAt(0);
    pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(el, 'pointermove', {
      clientX: 10 + DRAG_THRESHOLD_PX,
      clientY: 10,
    });
    flushFrames();

    expect(noteAt(0).dataset.dragging).toBe('true');
    // negative: grabbing a note is never a pan
    expect(readCamera()).toEqual(cameraBefore);
    // at zoom 1 a screen pixel is a world unit
    expect(notePosition(0)).toEqual({ x: start.x + DRAG_THRESHOLD_PX, y: start.y });
  });

  it('TC-21 cancels mid-drag: the note stays where it was last shown and is selected', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const start = notePosition(0);

    const el = noteAt(0);
    pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(el, 'pointermove', { clientX: 50, clientY: 10 });
    flushFrames();
    const position = notePosition(0);
    expect(position).toEqual({ x: start.x + 40, y: start.y });

    // the pointer is taken away by the system: no pointerup ever arrives
    pointerOn(el, 'pointercancel', { clientX: 90, clientY: 10 });
    flushFrames();

    expect(noteAt(0).dataset.dragging).toBe('false');
    expect(notePosition(0)).toEqual(position);
    expect(selectionCount()).toBe(1);
  });

  it('TC-22 clicks the empty board: the note is deselected and its tools go away', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    expect(noteToolbarOpen()).toBe(true);

    clickBoard(600, 500);

    expect(selectionCount()).toBe(0);
    expect(noteToolbarOpen()).toBe(false);
    expect(noteCount()).toBe(1);
  });

  it('TC-22 moves the selection to another note instead of leaving two outlines', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 400, y: 0 });

    clickOn(noteAt(0));
    clickOn(noteAt(1));

    expect(selectionCount()).toBe(1);
    expect(noteElements()[1].dataset.selected).toBe('true');
    expect(noteElements()[0].dataset.selected).toBe('false');
  });

  it('TC-25 Delete removes the selected note', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 300, y: 0 });
    clickOn(noteAt(0));

    pressKey('Delete');

    expect(noteCount()).toBe(1);
    expect(selectionCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-25 Backspace removes the selected note', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));

    pressKey('Backspace');

    expect(noteCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-36 does nothing on Enter with nothing selected', () => {
    renderBoard();
    const camera = readCamera();

    pressKey('Enter');

    expect(isEditing()).toBe(false);
    expect(noteCount()).toBe(0);
    expect(readCamera()).toEqual(camera);
  });

  it('TC-35 double-clicks a note to edit it, without creating another note', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });

    doubleClickOn(noteAt(0));

    expect(noteCount()).toBe(1);
    expect(isEditing()).toBe(true);
    expect(noteAt(0).dataset.noteId).toBe(id);
    expect(selectionCount()).toBe(1);
  });

  it('TC-37 stops quietly when a note is deleted while it is being dragged', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });

    const el = noteAt(0);
    pointerOn(el, 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(el, 'pointermove', { clientX: 70, clientY: 10 });
    flushFrames();

    // the note goes away mid-gesture (story 3 can do this with a remote delete)
    act(() => {
      deleteObject(doc, id);
    });
    expect(noteCount()).toBe(0);

    // the rest of the gesture arrives on an element that is no longer on screen
    pointerOn(el, 'pointermove', { clientX: 120, clientY: 10 });
    pointerOn(el, 'pointerup', { clientX: 120, clientY: 10 });
    flushFrames();

    expect(noteCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
  });

  it('TC-37 stops quietly when a note is deleted while it is being typed in', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    doubleClickOn(noteAt(0));
    expect(isEditing()).toBe(true);

    act(() => {
      deleteObject(doc, id);
    });

    expect(isEditing()).toBe(false);
    expect(noteCount()).toBe(0);

    // keys pressed afterwards find nothing to work on
    pressKey('Escape');
    pressKey('Delete');
    expect(noteCount()).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-22 keeps the note on top of the notes it was dragged across', () => {
    const { doc } = renderBoard();
    const dragged = newNote(doc, { x: 0, y: 0 });
    const other = newNote(doc, { x: 300, y: 0 });

    dragNote(0, 200, 0);

    // the dragged note is drawn on top of the other one
    expect(paintOrder().map((entry) => entry.id)).toEqual([other, dragged]);
    expect(paintOrder()[1].z).toBeGreaterThan(paintOrder()[0].z);
    // it got there by its stacking number alone: the element it lives in never
    // moved, which is what keeps the pointer holding it from being dropped
    expect(noteOrder().map((entry) => entry.id)).toEqual([dragged, other]);
  });

  it('TC-22 a note that is already topmost does not get a new z while dragging', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const top = newNote(doc, { x: 300, y: 0 });
    const zBefore = noteOrder()[1].z;

    dragNote(1, 20, 0);

    expect(noteOrder()[1].id).toBe(top);
    expect(noteOrder()[1].z).toBe(zBefore);
  });

  it('TC-22 raises the note once for a whole drag, not once per pointer move', () => {
    const { doc } = renderBoard();
    const dragged = newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 300, y: 0 });
    newNote(doc, { x: 600, y: 0 });
    const zBefore = paintOrder()[0].z;
    const raised: number[] = [];
    doc.on('update', () => {
      const note = snapshot(doc).find((entry) => entry.id === dragged);
      if (note !== undefined && note.z !== raised.at(-1)) raised.push(note.z);
    });

    dragNote(0, 300, 0, 12);

    // one raise for the whole gesture, however many moves it was made of: the
    // note went from the bottom of three to the top with a single new z
    expect(paintOrder()[2].id).toBe(dragged);
    expect(paintOrder()[2].z).toBe(zBefore + 3);
    expect(raised).toEqual([zBefore + 3]);
  });

  it('TC-22 clicking a note does not pan the board and does not clear its own selection', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const camera = readCamera();

    dragNote(0, 40, 20);

    expect(readCamera()).toEqual(camera);
    expect(selectionCount()).toBe(1);
  });
});
