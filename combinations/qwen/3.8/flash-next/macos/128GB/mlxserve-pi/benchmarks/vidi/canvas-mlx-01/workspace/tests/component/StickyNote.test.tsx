import { describe, expect, it } from 'vitest';
import { deleteObject, bringToFront } from '../../src/shared/board-model.js';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config.js';
import { boardDown, boardUp, flush, key, readCamera, INITIAL_CAMERA } from './harness.js';
import {
  boardDoc,
  dblClickNote,
  editorIn,
  isSelected,
  modelNote,
  noteCancel,
  noteCount,
  noteDown,
  noteEl,
  noteMove,
  noteUp,
  renderSticky,
  seedNote,
  toolbarIn,
} from './stickyHarness.js';

// The screen centre of a note created at world (0,0) with the initial camera.
const NOTE_CENTRE = { x: 640, y: 400 };

describe('select and deselect (TC-18, TC-22)', () => {
  it('TC-18 press-and-release without moving selects the note and shows its toolbar', async () => {
    renderSticky();
    const id = await seedNote(0, 0);

    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    expect(isSelected(id)).toBe(true);

    await noteUp(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    expect(isSelected(id)).toBe(true);
    expect(toolbarIn(id)).not.toBeNull();
  });

  it('TC-22 clicking empty board space clears the selection and hides the toolbar', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteUp(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    expect(isSelected(id)).toBe(true);

    await boardDown(150, 150);
    await boardUp(150, 150);

    expect(isSelected(id)).toBe(false);
    expect(toolbarIn(id)).toBeNull();
  });
});

describe('drag to move (TC-19, TC-20, TC-21)', () => {
  it('TC-19 a 2px move (below the threshold) stays a press and moves nothing', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    const before = modelNote(id)!;

    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteMove(id, NOTE_CENTRE.x + DRAG_THRESHOLD_PX - 1, NOTE_CENTRE.y);

    expect(modelNote(id)!.x).toBe(before.x);
    expect(modelNote(id)!.y).toBe(before.y);
    expect(noteEl(id)!.dataset.dragging).toBe('false');

    await noteUp(id, NOTE_CENTRE.x + 2, NOTE_CENTRE.y);
    expect(isSelected(id)).toBe(true);
  });

  it('TC-20 a 3px move (exactly the threshold) begins a drag and never pans the board', async () => {
    renderSticky();
    const cameraBefore = readCamera();
    expect(cameraBefore).toEqual(INITIAL_CAMERA);

    const id = await seedNote(0, 0);
    const before = modelNote(id)!;

    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteMove(id, NOTE_CENTRE.x + DRAG_THRESHOLD_PX, NOTE_CENTRE.y);

    expect(noteEl(id)!.dataset.dragging).toBe('true');
    // the note moved by the drag delta in world units (zoom 1)
    expect(modelNote(id)!.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    // the board camera never moved: dragging a note is not a pan
    expect(readCamera()).toEqual(INITIAL_CAMERA);
  });

  it('TC-21 pointercancel during a drag leaves the note selected at its last position', async () => {
    renderSticky();
    const id = await seedNote(0, 0);

    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteMove(id, NOTE_CENTRE.x + 20, NOTE_CENTRE.y + 10);
    const last = modelNote(id)!;

    await noteCancel(id);

    expect(isSelected(id)).toBe(true);
    expect(noteEl(id)!.dataset.dragging).toBe('false');
    expect(modelNote(id)!.x).toBeCloseTo(last.x, 6);
    expect(modelNote(id)!.y).toBeCloseTo(last.y, 6);
  });
});

describe('keyboard delete on a selected note (TC-25)', () => {
  it('Delete removes the selected note', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteUp(id, NOTE_CENTRE.x, NOTE_CENTRE.y);

    await key({ key: 'Delete' });

    expect(noteEl(id)).toBeNull();
    expect(modelNote(id)).toBeUndefined();
  });

  it('Backspace removes the selected note', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteUp(id, NOTE_CENTRE.x, NOTE_CENTRE.y);

    await key({ key: 'Backspace' });

    expect(noteEl(id)).toBeNull();
    expect(modelNote(id)).toBeUndefined();
  });
});

describe('negative flows (TC-35, TC-36)', () => {
  it('TC-35 double-clicking an existing note edits it and creates nothing new', async () => {
    renderSticky();
    const id = await seedNote(0, 0);

    await dblClickNote(id);

    expect(noteCount()).toBe(1);
    expect(editorIn(id)).not.toBeNull();
  });

  it('TC-36 Enter with nothing selected does nothing', async () => {
    renderSticky();
    const prevented = await key({ key: 'Enter' });

    expect(prevented).toBe(false);
    expect(noteCount()).toBe(0);
  });
});

describe('note deleted mid-interaction (TC-37)', () => {
  it('ending a drag after the note was deleted ends silently and never recreates it', async () => {
    renderSticky();
    const id = await seedNote(0, 0);

    await noteDown(id, NOTE_CENTRE.x, NOTE_CENTRE.y);
    await noteMove(id, NOTE_CENTRE.x + 30, NOTE_CENTRE.y + 20);
    expect(noteEl(id)!.dataset.dragging).toBe('true');

    // A model call (another user, or an undo) removes it mid-drag.
    deleteObject(boardDoc(), id);
    await flush();
    expect(noteEl(id)).toBeNull();

    // The dangling release is harmless and does not resurrect the note.
    await flush();
    expect(noteEl(id)).toBeNull();
    expect(noteCount()).toBe(0);
  });

  it('a model delete while editing tears the note down and nothing recreates it', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await dblClickNote(id);
    expect(editorIn(id)).not.toBeNull();

    deleteObject(boardDoc(), id);
    await flush();
    expect(noteEl(id)).toBeNull();
    expect(noteCount()).toBe(0);
    // A stray model op on the dead object is a no-op, not a recreation.
    expect(() => bringToFront(boardDoc(), id)).not.toThrow();
    expect(noteCount()).toBe(0);
  });
});
