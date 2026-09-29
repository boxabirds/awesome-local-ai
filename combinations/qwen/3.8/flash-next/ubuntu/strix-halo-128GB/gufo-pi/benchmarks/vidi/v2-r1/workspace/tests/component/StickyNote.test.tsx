import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../../src/client/App';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  CENTRE,
  createNote,
  createNoteWithText,
  centreOf,
  clickEmptyBoard,
  currentCamera,
  doc,
  dragNote,
  editor,
  modelNotes,
  note,
  noteCount,
  pointOnNote,
  selectNote,
  setCamera,
  surface,
  textOf,
  typeText,
  view,
  watchLocalUpdates,
} from './sticky-helpers';

/**
 * sticky.interaction: selecting, dragging, double-click creating and keyboard
 * deleting notes, in the rendered app against a real Y.Doc.
 *
 * Positions are asserted through the camera math: a screen delta of `d` moves a
 * note by `d / zoom` world units, and the point that was grabbed stays under the
 * pointer. The camera is read before each gesture, so the assertions hold for
 * whatever zoom the test set.
 */

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  render(<App boardId="test-board-00000000ab" />);
});

describe('creating and selecting a note', () => {
  it('TC-18 press and release without moving selects the note and shows its toolbar', () => {
    createNoteWithText('picked', CENTRE);
    clickEmptyBoard();
    expect(view(0).selected).toBe(false);

    const at = centreOf(0);
    fireEvent.pointerDown(note(), { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    // pressed is not yet selected: a press that turns into a drag must not select
    expect(view(0).selected).toBe(false);

    fireEvent.pointerUp(note(), { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });

    // the selection marker is `data-selected`, which the outline is drawn from
    expect(view(0).selected).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('TC-19 moving 2px stays below DRAG_THRESHOLD_PX and writes no move', () => {
    createNoteWithText('held', CENTRE);
    const before = view(0);
    const updates = watchLocalUpdates();

    const at = centreOf(0);
    const element = note();
    fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(element, {
      clientX: at.x + DRAG_THRESHOLD_PX - 1,
      clientY: at.y,
      pointerId: 1,
      buttons: 1,
    });
    expect(view(0).dragging).toBe(false);
    fireEvent.pointerUp(element, {
      clientX: at.x + DRAG_THRESHOLD_PX - 1,
      clientY: at.y,
      pointerId: 1,
      button: 0,
    });

    expect(view(0).selected).toBe(true);
    expect(view(0).x).toBe(before.x);
    expect(view(0).y).toBe(before.y);
    expect(modelNotes()[0]?.x).toBe(before.x);
    // no moveObject, no bringToFront: the document was not touched at all
    expect(updates.count()).toBe(0);
    updates.stop();
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX drags the note and leaves the camera alone', () => {
    createNoteWithText('heavy', CENTRE);
    const cameraBefore = currentCamera();
    const before = view(0);

    const at = centreOf(0);
    const element = note();
    fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(element, {
      clientX: at.x + DRAG_THRESHOLD_PX,
      clientY: at.y,
      pointerId: 1,
      buttons: 1,
    });
    // 3 px of travel is a drag, not a click
    expect(view(0).dragging).toBe(true);
    fireEvent.pointerUp(element, {
      clientX: at.x + DRAG_THRESHOLD_PX,
      clientY: at.y,
      pointerId: 1,
      button: 0,
    });

    const after = view(0);
    const zoom = cameraBefore.zoom;
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX / zoom, 6);
    // the board never panned because the press started on a note
    const cameraAfter = currentCamera();
    expect(cameraAfter.x).toBe(cameraBefore.x);
    expect(cameraAfter.y).toBe(cameraBefore.y);
    expect(cameraAfter.zoom).toBe(cameraBefore.zoom);
    expect(after.selected).toBe(true);
  });

  it('TC-21 pointercancel during a drag leaves the note selected where it was last shown', () => {
    createNoteWithText('cancelled', CENTRE);
    const before = view(0);
    const zoom = currentCamera().zoom;

    const at = centreOf(0);
    const element = note();
    fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(element, {
      clientX: at.x + 60,
      clientY: at.y + 40,
      pointerId: 1,
      buttons: 1,
    });
    expect(view(0).dragging).toBe(true);

    fireEvent.pointerCancel(element, { clientX: at.x + 60, clientY: at.y + 40, pointerId: 1 });

    expect(view(0).dragging).toBe(false);
    expect(view(0).selected).toBe(true);
    // the position the pointer last reached is kept, and it is in the model too
    expect(view(0).x).toBeCloseTo(before.x + 60 / zoom, 6);
    expect(view(0).y).toBeCloseTo(before.y + 40 / zoom, 6);
    const lastKnown = view(0);
    expect(modelNotes()[0]?.x).toBe(lastKnown.x);
    expect(modelNotes()[0]?.y).toBe(lastKnown.y);

    // a later pointerup for the same pointer does nothing at all
    fireEvent.pointerUp(element, { clientX: at.x + 200, clientY: at.y + 200, pointerId: 1 });
    expect(view(0).x).toBe(lastKnown.x);
  });

  it('TC-22 clicking empty board clears the selection and hides the toolbar', () => {
    createNoteWithText('lonely', CENTRE);
    selectNote(0);
    expect(view(0).selected).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    clickEmptyBoard();

    expect(view(0).selected).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-35 double-clicking an existing note edits it instead of creating another', () => {
    createNoteWithText('original', { x: 300, y: 300 });
    expect(noteCount()).toBe(1);

    fireEvent.doubleClick(note(), centreOf(0));

    expect(noteCount()).toBe(1);
    expect(modelNotes()).toHaveLength(1);
    expect(view(0).editing).toBe(true);
    expect(editor().value).toBe('original');
  });

  it('TC-36 Enter with nothing selected neither creates nor edits a note', () => {
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(noteCount()).toBe(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(modelNotes()).toHaveLength(0);

    // and after a note exists but is only deselected again
    createNoteWithText('other', CENTRE);
    clickEmptyBoard();
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(noteCount()).toBe(1);
    expect(view(0).editing).toBe(false);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });

  it('the navigation hint is shown only on a board without notes', () => {
    expect(screen.getByTestId('navigation-hint')).not.toBeNull();

    createNote(CENTRE);

    expect(screen.queryByTestId('navigation-hint')).toBeNull();
  });
});

describe('dragging notes', () => {
  it('the grabbed point stays under the pointer and the note moves by delta / zoom', () => {
    createNoteWithText('moved', CENTRE);
    const camera = currentCamera();
    const before = view(0);
    // grab the note well off its centre
    const grab = pointOnNote(0, 30, 150);
    const delta = { x: 120, y: -80 };

    const element = note();
    fireEvent.pointerDown(element, { clientX: grab.x, clientY: grab.y, pointerId: 1, button: 0 });
    for (let step = 1; step <= 4; step += 1) {
      fireEvent.pointerMove(element, {
        clientX: grab.x + (delta.x * step) / 4,
        clientY: grab.y + (delta.y * step) / 4,
        pointerId: 1,
        buttons: 1,
      });
    }
    fireEvent.pointerUp(element, {
      clientX: grab.x + delta.x,
      clientY: grab.y + delta.y,
      pointerId: 1,
      button: 0,
    });

    const after = view(0);
    const from = screenToWorld(camera, grab);
    const to = screenToWorld(camera, { x: grab.x + delta.x, y: grab.y + delta.y });
    expect(after.x).toBeCloseTo(before.x + (to.x - from.x), 6);
    expect(after.y).toBeCloseTo(before.y + (to.y - from.y), 6);
    // the same point of the note is still under the pointer: the offset between
    // the pointer and the note's top-left did not change
    const grabbedOffset = { x: grab.x - before.x, y: grab.y - before.y };
    const nowOffset = {
      x: grab.x + delta.x - after.x,
      y: grab.y + delta.y - after.y,
    };
    expect(nowOffset.x).toBeCloseTo(grabbedOffset.x * 1, 4);
    expect(nowOffset.y).toBeCloseTo(grabbedOffset.y * 1, 4);
  });

  it('a drag at 200% zoom moves half as many world units as the pointer travels', async () => {
    await setCamera({ ...currentCamera(), zoom: 2 });
    createNoteWithText('zoomed', CENTRE);
    const before = view(0);

    dragNote(0, { x: 100, y: 50 });

    const after = view(0);
    expect(after.x).toBeCloseTo(before.x + 50, 6);
    expect(after.y).toBeCloseTo(before.y + 25, 6);
  });

  it('dragging one note above another brings it to the front', () => {
    createNoteWithText('below', CENTRE);
    createNoteWithText('above', { x: CENTRE.x + 60, y: CENTRE.y + 40 });
    const below = modelNotes()[0]!;
    const above = modelNotes()[1]!;
    expect(below.z).toBeLessThan(above.z);

    // drag the bottom note over the top one
    dragNote(0, { x: 120, y: 80 });

    const notes = modelNotes();
    expect(notes[notes.length - 1]?.id).toBe(below.id);
    expect(notes[0]?.id).toBe(above.id);
    // the dragged note went to the top exactly once, not once per pointer move
    expect(notes[notes.length - 1]?.z).toBe(above.z + 1);
  });

  it('a drag that ends on the board does not create a note', () => {
    createNoteWithText('still one', CENTRE);
    dragNote(0, { x: 40, y: 40 });
    expect(noteCount()).toBe(1);
  });
});

describe('deleting with the keyboard', () => {
  it('TC-25 Delete on a selected note removes it', () => {
    createNoteWithText('doomed', CENTRE);
    createNoteWithText('kept', { x: 200, y: 200 });
    const doomed = view(0);
    selectNote(0);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(noteCount()).toBe(1);
    expect(textOf(0)).toBe('kept');
    const remaining = modelNotes().map((entry) => entry.id);
    expect(remaining).not.toContain(doomed.id);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(view(0).selected).toBe(false);
  });

  it('TC-25 Backspace on a selected note removes it too', () => {
    createNoteWithText('doomed', CENTRE);
    selectNote(0);

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(noteCount()).toBe(0);
    expect(modelNotes()).toHaveLength(0);
    // and with nothing on the board, another Backspace is harmless
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(noteCount()).toBe(0);
  });

  it('a note deleted from the document while selected hides its toolbar', () => {
    createNoteWithText('one', CENTRE);
    selectNote(0);
    const id = view(0).id;

    act(() => {
      deleteObject(doc(), id);
    });

    expect(noteCount()).toBe(0);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('a note that disappears during an interaction', () => {
  it('TC-37 deleted from the document mid-drag: the drag ends and the note is not recreated', () => {
    createNoteWithText('vanishing', CENTRE);
    const before = view(0);
    const id = before.id;
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener('error', onError);

    const at = centreOf(0);
    const element = note();
    fireEvent.pointerDown(element, { clientX: at.x, clientY: at.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(element, {
      clientX: at.x + 40,
      clientY: at.y + 40,
      pointerId: 1,
      buttons: 1,
    });
    expect(view(0).dragging).toBe(true);

    act(() => {
      deleteObject(doc(), id);
    });
    expect(noteCount()).toBe(0);

    // the pointer keeps moving and releases on a note that no longer exists
    const gone = screen.queryByTestId('sticky-note');
    expect(gone).toBeNull();
    expect(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
      fireEvent.keyDown(window, { key: 'Enter' });
    }).not.toThrow();

    expect(noteCount()).toBe(0);
    expect(modelNotes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });

  it('TC-37 deleted from the document mid-edit: editing ends and the note is not recreated', () => {
    createNote(CENTRE);
    typeText('half typed');
    const id = view(0).id;

    act(() => {
      deleteObject(doc(), id);
    });

    expect(noteCount()).toBe(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(modelNotes()).toHaveLength(0);

    // typing afterwards cannot bring the note back
    expect(() => {
      fireEvent.keyDown(window, { key: 'x' });
      fireEvent.keyDown(window, { key: 'Enter' });
    }).not.toThrow();
    expect(snapshot(doc())).toHaveLength(0);
  });
});

describe('panning and zooming are not confused with note gestures', () => {
  it('TC-35 style guard: a press that starts on the board pans, and does not select or create', () => {
    createNoteWithText('pinned', CENTRE);
    const cameraBefore = currentCamera();
    const before = view(0);

    fireEvent.pointerDown(surface(), { clientX: 100, clientY: 100, pointerId: 4, button: 0 });
    fireEvent.pointerMove(surface(), { clientX: 180, clientY: 140, pointerId: 4, buttons: 1 });
    fireEvent.pointerUp(surface(), { clientX: 180, clientY: 140, pointerId: 4, button: 0 });

    const cameraAfter = currentCamera();
    expect(cameraAfter.x).toBeCloseTo(cameraBefore.x - 80 / cameraBefore.zoom, 6);
    expect(cameraAfter.y).toBeCloseTo(cameraBefore.y - 40 / cameraBefore.zoom, 6);
    expect(noteCount()).toBe(1);
    expect(view(0).x).toBe(before.x);
    expect(view(0).y).toBe(before.y);
  });

  it('a wheel over a note zooms the board and leaves the note where it was', () => {
    createNoteWithText('anchored', CENTRE);
    const before = view(0);

    fireEvent.wheel(note(), { clientX: CENTRE.x, clientY: CENTRE.y, deltaY: -120, ctrlKey: true });

    expect(currentCamera().zoom).toBeGreaterThan(1);
    expect(view(0).x).toBe(before.x);
    expect(view(0).y).toBe(before.y);
    expect(noteCount()).toBe(1);
  });

  it('a double-click on the board where no note is creates one, centred on the point', () => {
    createNote({ x: 500, y: 250 });

    expect(noteCount()).toBe(1);
    const world = screenToWorld(currentCamera(), { x: 500, y: 250 });
    expect(view(0).x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 6);
    expect(view(0).y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 6);
    expect(view(0).editing).toBe(true);
  });
});
