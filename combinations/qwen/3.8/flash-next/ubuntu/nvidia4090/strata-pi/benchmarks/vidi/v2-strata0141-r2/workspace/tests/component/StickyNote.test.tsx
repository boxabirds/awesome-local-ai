import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { deleteObject } from '../../src/shared/board-model';
import {
  addNote,
  click,
  cancel,
  doubleClick,
  key,
  moveTo,
  mutate,
  press,
  release,
  renderApp,
} from './appHarness';

/**
 * sticky.interaction component tests (TC-18 to TC-22, TC-25, TC-35 to TC-37)
 * against a real Y.Doc through the real App tree.
 */

const NOTE_CENTRE = { x: 0, y: 0 };

describe('sticky note interaction', () => {
  // TC-18
  it('TC-18: press and release without moving selects the note and shows its toolbar', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, NOTE_CENTRE.x, NOTE_CENTRE.y);
    const note = h.note(id);
    h.resetLocalUpdates();

    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-dragging')).toBe('false');
    expect(h.noteToolbar(note)).not.toBeNull();
    // Selection is local: it must not touch the shared document.
    expect(h.localUpdates()).toBe(0);
  });

  // TC-19
  it('TC-19: a 2px move stays under DRAG_THRESHOLD_PX and writes no move', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 40, 60);
    const note = h.note(id);
    const before = h.byId(id);
    h.resetLocalUpdates();

    await press(note, { x: 300, y: 300 });
    await moveTo(note, { x: 301, y: 301 });
    await moveTo(note, { x: 302, y: 302 });
    await release(note, { x: 302, y: 302 });

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-dragging')).toBe('false');
    expect(h.byId(id)).toEqual(before);
    expect(h.localUpdates()).toBe(0);
  });

  // TC-20
  it('TC-20: a 3px move reaches the threshold, drags the note and never pans the board', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    const before = h.byId(id);
    const cameraBefore = h.camera();

    await press(note, { x: 300, y: 300 });
    await moveTo(note, { x: 303, y: 300 });

    expect(note.getAttribute('data-dragging')).toBe('true');
    // Negative case: the board itself did not pan.
    expect(h.camera()).toEqual(cameraBefore);
    expect(h.viewport().getAttribute('data-panning')).toBe('false');

    await h.flushFrames();
    const moved = h.byId(id);
    expect(moved?.x).toBeCloseTo((before?.x ?? 0) + 3, 6);
    expect(moved?.y).toBeCloseTo(before?.y ?? 0, 6);

    await release(note, { x: 303, y: 300 });
    expect(note.getAttribute('data-dragging')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('true');
  });

  it('a dragged note is written at the pointer delta divided by zoom', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    // A zoomed camera through the real zoom control, so the division is real too.
    await click(h.view.getByTestId('zoom-out')); // 100% -> 80%
    await click(h.view.getByTestId('zoom-out')); // 80% -> 64%
    await h.flushFrames();
    const zoom = h.camera().zoom;
    expect(zoom).toBeCloseTo(0.64, 6);
    const before = h.byId(id);

    const note = h.note(id);
    await press(note, { x: 100, y: 100 });
    await moveTo(note, { x: 164, y: 132 });
    await h.flushFrames();

    const moved = h.byId(id);
    expect(moved?.x).toBeCloseTo((before?.x ?? 0) + 64 / zoom, 6);
    expect(moved?.y).toBeCloseTo((before?.y ?? 0) + 32 / zoom, 6);
    await release(note, { x: 164, y: 132 });
  });

  // TC-21
  it('TC-21: pointercancel mid-drag keeps the last applied position and selects the note', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    const origin = h.byId(id)?.x ?? 0;

    await press(note, { x: 100, y: 100 });
    await moveTo(note, { x: 140, y: 100 });
    await h.flushFrames();
    const applied = h.byId(id);
    expect(applied?.x).toBeCloseTo(origin + 40, 6);

    // A further move is queued for the next frame and never applied.
    await moveTo(note, { x: 200, y: 100 });
    await cancel(note, { x: 200, y: 100 });

    expect(note.getAttribute('data-dragging')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(h.byId(id)?.x).toBeCloseTo(origin + 40, 6);
  });

  // TC-22
  it('TC-22: clicking empty board space clears the selection and its toolbar', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);

    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });
    expect(h.noteToolbar(note)).not.toBeNull();

    await press(h.viewport(), { x: 700, y: 500 });
    await release(h.viewport(), { x: 700, y: 500 });

    expect(note.getAttribute('data-selected')).toBe('false');
    expect(h.noteToolbar(note)).toBeNull();
  });

  it('dragging the board does not select or move a note', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    const before = h.byId(id);

    await press(h.viewport(), { x: 700, y: 500 });
    await moveTo(h.viewport(), { x: 800, y: 560 });
    await h.flushFrames();
    await release(h.viewport(), { x: 800, y: 560 });

    expect(h.byId(id)).toEqual(before);
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(h.camera().x).not.toBe(0);
  });

  // TC-25
  it('TC-25: Delete removes the selected note', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });

    await key(window, 'Delete');

    expect(h.notes()).toHaveLength(0);
    expect(h.snapshots()).toHaveLength(0);
  });

  it('TC-25: Backspace removes the selected note', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });

    await key(window, 'Backspace');

    expect(h.notes()).toHaveLength(0);
    expect(h.snapshots()).toHaveLength(0);
  });

  it('Delete with nothing selected removes nothing', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);

    await key(window, 'Delete');

    expect(h.notes()).toHaveLength(1);
    expect(h.byId(id)).toBeDefined();
  });

  // TC-35
  it('TC-35: double-clicking a note edits it and does not create another note', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);

    await doubleClick(note, { x: 300, y: 300 });

    expect(h.notes()).toHaveLength(1);
    expect(h.snapshots()).toHaveLength(1);
    expect(note.getAttribute('data-editing')).toBe('true');
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(h.textarea(note)).not.toBeNull();
    expect(h.byId(id)?.id).toBe(id);
  });

  // TC-36
  it('TC-36: Enter with nothing selected does nothing', async () => {
    const h = await renderApp();
    await addNote(h.doc, 0, 0);

    await key(window, 'Enter');

    expect(h.textarea()).toBeNull();
    expect(h.notes()[0]?.getAttribute('data-editing')).toBe('false');
    expect(h.snapshots()).toHaveLength(1);
  });

  // TC-37
  it('TC-37: a note deleted through the model mid-drag ends the drag and is not recreated', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);

    await press(note, { x: 100, y: 100 });
    await moveTo(note, { x: 140, y: 100 });
    await h.flushFrames();

    await mutate(() => deleteObject(h.doc, id));

    expect(h.notes()).toHaveLength(0);

    // The pointer keeps moving after the note is gone: nothing is recreated.
    await moveTo(note, { x: 180, y: 140 });
    await release(note, { x: 180, y: 140 });
    await h.flushFrames();

    expect(h.notes()).toHaveLength(0);
    expect(h.snapshots()).toHaveLength(0);
  });

  it('TC-37: a note deleted while editing closes the editor and is not recreated', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    await doubleClick(note, { x: 300, y: 300 });
    const area = h.textarea(note);
    expect(area).not.toBeNull();

    await mutate(() => deleteObject(h.doc, id));

    expect(h.notes()).toHaveLength(0);
    expect(h.textarea()).toBeNull();
    expect(h.snapshots()).toHaveLength(0);
  });

  it('a note is keyboard reachable and Enter on the focused note starts editing', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);

    // Tab reaches the note (tabIndex 0), Enter edits it.
    expect(note.getAttribute('tabindex')).toBe('0');
    note.focus();
    await key(note, 'Enter');

    expect(note.getAttribute('data-editing')).toBe('true');
    expect(h.textarea(note)).not.toBeNull();
  });

  it('notes are stacked in snapshot order and a drag brings the note to the front', async () => {
    const h = await renderApp();
    const first = await addNote(h.doc, 0, 0);
    const second = await addNote(h.doc, 10, 10);
    expect(h.snapshots().map((entry) => entry.id)).toEqual([first, second]);
    expect(h.snapshots().map((entry) => entry.z)).toEqual([1, 2]);

    const note = h.note(first);
    await press(note, { x: 100, y: 100 });
    await moveTo(note, { x: 100 + DRAG_THRESHOLD_PX, y: 100 });
    await h.flushFrames();
    await release(note, { x: 100 + DRAG_THRESHOLD_PX, y: 100 });

    const after = h.snapshots();
    expect(after.map((entry) => entry.id)).toEqual([second, first]);
    expect(after[1]?.z).toBe(3);
    expect(h.note(first).style.zIndex).toBe('3');
    void STICKY_SIZE_WORLD;
  });
});
