/**
 * Sticky note interaction (spec anchor `sticky.interaction`) — selection,
 * dragging without panning, raising, deletion, and a note that disappears in the
 * middle of an interaction.
 *
 * TC-18 press and release without moving            → Selected, outline + toolbar
 * TC-19 press, move 2 px (below threshold), release → Selected, note did not move
 * TC-20 drag from a note at exactly 3 px            → Dragging, camera did not move
 * TC-21 cancel while dragging                       → Selected, last position kept
 * TC-22 click empty board                           → Unselected, toolbar gone
 * TC-25 Delete / Backspace on a selected note       → note removed (separate runs)
 * TC-35 double-click an existing note               → that note edits, no new note
 * TC-36 Enter with nothing selected                 → nothing created or edited
 * TC-37 note deleted mid-drag / mid-edit            → ends silently, not recreated
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';

import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  advanceFrames,
  renderStickyApp,
  worldAt,
  type StickyAppHandle,
} from './stickyHarness';

let board!: StickyAppHandle;

beforeEach(async () => {
  board = await renderStickyApp();
});

/** Press, drag and release a note in one go. */
async function dragNote(index: number, from: { x: number; y: number }, to: { x: number; y: number }) {
  const note = board.note(index);
  await board.press(note, from.x, from.y);
  await board.moveTo(to.x, to.y);
  await board.release(to.x, to.y);
}

describe('sticky.interaction: select', () => {
  it('TC-18 presses and releases a note without moving: it is selected, outlined, with its toolbar', async () => {
    await board.addNote();
    const note = board.note();

    // Nothing is selected to begin with.
    expect(note.dataset.selected).toBe('false');
    expect(hasNoteToolbar()).toBe(false);

    await board.press(note, 100, 100);
    await board.release(100, 100);

    expect(board.note().dataset.selected).toBe('true');
    expect(board.note().classList.contains('sticky-note--selected')).toBe(true);
    expect(hasNoteToolbar()).toBe(true);
  });

  it('TC-19 moves 2 px (below DRAG_THRESHOLD_PX): the note is selected and did not move', async () => {
    const id = await board.addNote();
    const before = snapshot(board.doc).find((note) => note.id === id)!;
    const note = board.note();

    await board.press(note, 100, 100);
    await board.moveTo(100 + (DRAG_THRESHOLD_PX - 1), 100);
    await board.release(100 + (DRAG_THRESHOLD_PX - 1), 100);

    const after = snapshot(board.doc).find((item) => item.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-22 clicks empty board space: the note is deselected and its toolbar is gone', async () => {
    await board.addNote();
    await board.press(board.note(), 100, 100);
    await board.release(100, 100);
    expect(board.note().dataset.selected).toBe('true');

    await board.clickEmpty(20, 20);

    expect(board.note().dataset.selected).toBe('false');
    expect(hasNoteToolbar()).toBe(false);
  });

  it('TC-36 presses Enter with nothing selected: no note is created and none is edited', async () => {
    expect(board.noteIds()).toEqual([]);

    await board.pressKey('Enter');

    expect(board.noteIds()).toEqual([]);
    expect(screen.queryByTestId('sticky-note-editor')).toBeNull();
  });
});

describe('sticky.interaction: move', () => {
  it('TC-20 drags a note at exactly the threshold: the note moves and the camera does not', async () => {
    const id = await board.addNote();
    const before = snapshot(board.doc).find((note) => note.id === id)!;
    const cameraBefore = board.camera();

    await dragNote(0, { x: 300, y: 300 }, { x: 300 + DRAG_THRESHOLD_PX, y: 300 });

    const after = snapshot(board.doc).find((note) => note.id === id)!;
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 5);
    expect(board.camera()).toEqual(cameraBefore);
  });

  it('TC-21 cancels while dragging: the note keeps the last applied position and is selected', async () => {
    const id = await board.addNote();
    const before = snapshot(board.doc).find((note) => note.id === id)!;
    const note = board.note();

    await board.press(note, 300, 300);
    await board.moveTo(360, 340);
    const dragged = snapshot(board.doc).find((item) => item.id === id)!;
    expect(dragged.x).toBeCloseTo(before.x + 60, 5);

    await board.cancel();

    const settled = snapshot(board.doc).find((item) => item.id === id)!;
    expect(settled.x).toBeCloseTo(dragged.x, 5);
    expect(settled.y).toBeCloseTo(dragged.y, 5);
    expect(board.note().dataset.selected).toBe('true');
  });

  it('moves a note by the pointer delta in world units at 100% zoom and raises it above its neighbours', async () => {
    const bottom = await board.addNote({ x: 400, y: 300 });
    const top = await board.addNote({ x: 460, y: 340 });
    expect(snapshot(board.doc).at(-1)!.id).toBe(top);

    await dragNote(0, { x: 200, y: 200 }, { x: 250, y: 210 });

    const notes = snapshot(board.doc);
    const moved = notes.find((note) => note.id === bottom)!;
    const other = notes.find((note) => note.id === top)!;
    // The note was stored at top-left (300, 200); at 100 % zoom the screen delta
    // is the world delta.
    expect(moved.x).toBeCloseTo(300 + 50, 5);
    expect(moved.y).toBeCloseTo(200 + 10, 5);
    // The dragged note is drawn above the one it now overlaps.
    expect(moved.z).toBeGreaterThan(other.z);
    expect(notes.at(-1)!.id).toBe(bottom);
  });

  it('TC-37 deletes the note mid-drag: the drag ends silently and the note is not recreated', async () => {
    const id = await board.addNote();
    const note = board.note();
    await board.press(note, 300, 300);
    await board.moveTo(360, 340);

    await act(async () => {
      deleteObject(board.doc, id);
    });
    await advanceFrames();

    // The gesture carries on as if nothing had happened.
    await board.moveTo(400, 380);
    await board.release(400, 380);

    expect(snapshot(board.doc)).toEqual([]);
  });

  it('TC-37 deletes the note while it is being edited: editing ends and it is not recreated', async () => {
    const id = await board.addNote();
    await board.doubleClick(board.note(), 400, 300);
    await board.type('keep me');
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();

    await act(async () => {
      deleteObject(board.doc, id);
    });
    await advanceFrames();

    expect(snapshot(board.doc)).toEqual([]);
    expect(screen.queryByTestId('sticky-note-editor')).toBeNull();
  });
});

describe('sticky.interaction: create and edit entry points', () => {
  it('double-clicks empty board space to create a note centred there, already editing', async () => {
    const point = { x: 400, y: 300 };

    await board.doubleClick(board.viewport(), point.x, point.y);

    const world = worldAt(board, point);
    const notes = board.notes();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 5);
    expect(notes[0]!.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 5);
    expect(notes[0]!.color).toBe('yellow');
    // It accepts typing straight away.
    await board.type('Hello');
    expect(board.notes()[0]!.text).toBe('Hello');
  });

  it('TC-35 double-clicks an existing note: that note is edited and no second note appears', async () => {
    const id = await board.addNote({ x: 400, y: 300 });

    await board.doubleClick(board.note(), 400, 300);

    expect(board.noteIds()).toEqual([id]);
    expect(board.note().dataset.selected).toBe('true');
    expect(screen.getByTestId('sticky-note-editor')).toBeTruthy();
  });

  it('TC-25 deletes a selected note with Delete, and with Backspace in a separate run', async () => {
    await board.addNote();
    await board.press(board.note(), 100, 100);
    await board.release(100, 100);

    await board.pressKey('Delete');

    expect(board.noteIds()).toEqual([]);

    const second = await board.addNote();
    await board.press(board.note(), 100, 100);
    await board.release(100, 100);
    await board.pressKey('Backspace');

    expect(board.noteIds()).toEqual([]);
    expect(board.noteIds().includes(second)).toBe(false);
  });
});

/** The note toolbar is only rendered for the selected note. */
function hasNoteToolbar(): boolean {
  return screen.queryAllByTestId('note-toolbar').length > 0;
}
