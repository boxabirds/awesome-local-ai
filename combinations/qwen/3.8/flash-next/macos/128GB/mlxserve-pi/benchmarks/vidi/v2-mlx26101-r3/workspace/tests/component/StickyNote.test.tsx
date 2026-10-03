import { beforeEach, describe, expect, it } from 'vitest';
import { flushFrames } from './helpers';
import {
  cancelDrag,
  centreOf,
  clickAt,
  doubleClick,
  doubleClickBoard,
  dragWithPointer,
  loseCapture,
  mountSticky,
  moveTo,
  positionOf,
  press,
  pressKey,
  release,
  type MountedSticky,
} from './helpers/sticky';
import { createSticky, deleteObject, getStickyText } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * Sticky note interaction (sticky.interaction): press, drag, select, keyboard delete.
 *
 * jsdom has no layout, so what is proven here is the state machine and the writes it makes
 * to the document - not pixels. A note's on-screen point for a world point comes from the
 * rendered camera (the board area is at 0,0 in jsdom, so screen = world * zoom + camera).
 */

const NOTE_CENTRE = { x: 0, y: 0 };

/** A note whose centre is at world (0, 0), i.e. stored at its top-left. */
function seedNote(board: MountedSticky, at = NOTE_CENTRE): string {
  const id = createSticky(board.doc, at);
  if (id === '') {
    throw new Error('the test could not add a note');
  }
  return id;
}

describe('sticky.interaction: select (TC-18)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    board = await mountSticky();
    seedNote(board);
    await flushFrames();
  });

  it('TC-18: a press and release without moving selects the note', async () => {
    const note = board.note();
    expect(note.dataset.selected).toBe('false');
    expect(board.toolbarOrNull()).toBeNull();

    const at = board.screenOf(NOTE_CENTRE);
    clickAt(note, at);
    await flushFrames();

    expect(board.note().dataset.selected).toBe('true');
    expect(board.note().getAttribute('role')).toBe('group');
    expect(board.note().getAttribute('aria-label')).toBe('Sticky note');
    // The floating toolbar appears for the selected note and not for its neighbours.
    expect(board.toolbarOrNull()).not.toBeNull();
    // ...and it is marked as UI, so a press on it is never a press on the board.
    expect(board.toolbar().closest('[data-board-ui]')).not.toBeNull();
  });

  it('TC-18b: the note is drawn at its world position with the world size', () => {
    const note = board.note();
    expect(positionOf(note)).toEqual({
      x: NOTE_CENTRE.x - STICKY_SIZE_WORLD / 2,
      y: NOTE_CENTRE.y - STICKY_SIZE_WORLD / 2,
    });
    expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
  });
});

describe('sticky.interaction: move by dragging (TC-19 to TC-21)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    board = await mountSticky();
    seedNote(board);
    await flushFrames();
  });

  it('TC-19: two pixels of movement is a click, not a drag', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 2, y: at.y + 2 });
    release(board.note(), { x: at.x + 2, y: at.y + 2 });
    await flushFrames(3);

    expect(positionOf(board.note())).toEqual(before);
    expect(board.note().dataset.selected).toBe('true');
  });

  it('TC-19b: exactly the threshold moves the note by the pointer delta over zoom', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    await dragWithPointer(board.note(), at, {
      x: at.x + DRAG_THRESHOLD_PX,
      y: at.y + DRAG_THRESHOLD_PX,
    });

    const after = positionOf(board.note());
    const zoom = board.camera().zoom;
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX / zoom, 6);
    expect(after.y).toBeCloseTo(before.y + DRAG_THRESHOLD_PX / zoom, 6);
  });

  it('TC-19c: one drag writes one position per animation frame, ending under the pointer', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    const delta = { x: 120, y: 60 };
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 40, y: at.y + 20 });
    // Nothing is written until a frame runs: the document is not a log of mouse moves.
    expect(positionOf(board.note())).toEqual(before);
    await flushFrames();
    const mid = positionOf(board.note());
    expect(mid.x).toBeGreaterThan(before.x);
    moveTo(board.note(), { x: at.x + delta.x, y: at.y + delta.y });
    release(board.note(), { x: at.x + delta.x, y: at.y + delta.y });
    await flushFrames();

    const zoom = board.camera().zoom;
    expect(positionOf(board.note())).toEqual({
      x: before.x + delta.x / zoom,
      y: before.y + delta.y / zoom,
    });
  });

  it('TC-20: dragging a note never moves the camera', async () => {
    const cameraBefore = board.camera();
    const at = board.screenOf(NOTE_CENTRE);
    await dragWithPointer(board.note(), at, { x: at.x + 200, y: at.y + 150 });

    expect(board.camera()).toEqual(cameraBefore);
  });

  it('TC-20b: dragging a note brings it to the front, once', async () => {
    seedNote(board, { x: 300, y: 0 });
    await flushFrames();
    const [first, second] = board.notes();
    expect(second === undefined ? undefined : second.z).toBe((first?.z ?? 0) + 1);

    const at = board.screenOf(NOTE_CENTRE);
    await dragWithPointer(board.note(0), at, { x: at.x + 300, y: at.y });

    const moved = board.notes().find((note) => note.id === first?.id);
    expect(moved?.z).toBe(3);
  });

  it('TC-21: a cancelled drag keeps the last applied position', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 30, y: at.y });
    await flushFrames();
    const applied = positionOf(board.note());
    expect(applied.x).toBeGreaterThan(before.x);

    // The pointer moves on, but is taken away before the next frame gets a chance to write.
    moveTo(board.note(), { x: at.x + 300, y: at.y + 300 });
    cancelDrag(board.note(), { x: at.x + 300, y: at.y + 300 });
    await flushFrames(3);

    expect(positionOf(board.note())).toEqual(applied);
    expect(board.note().dataset.selected).toBe('true');
    expect(board.note().dataset.dragging).toBe('false');
  });

  it('TC-20c: the note underneath another one can still be dragged', async () => {
    // The note on top is the one that would be in the way if a drag depended on the DOM
    // order staying still: bringing the lower note to the front moves its element.
    seedNote(board, { x: 60, y: 40 });
    await flushFrames();
    const lower = board.notes()[0];
    if (lower === undefined) {
      throw new Error('the board has no notes');
    }
    const before = positionOf(board.note(0));
    const at = board.screenOf({ x: lower.x + 30, y: lower.y + 20 });

    await dragWithPointer(board.note(0), at, { x: at.x + 120, y: at.y + 60 });

    const zoom = board.camera().zoom;
    const moved = board.notes().find((note) => note.id === lower.id);
    expect(moved?.x).toBeCloseTo(before.x + 120 / zoom, 6);
    expect(moved?.y).toBeCloseTo(before.y + 60 / zoom, 6);
    // ...and it is on top of the stack now.
    expect(board.notes().at(-1)?.id).toBe(lower.id);
  });

  it('TC-21c: capture taken away in the middle of a drag does not stop the drag', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 30, y: at.y + 10 });
    await flushFrames();

    // Bringing the note to the front moved its element, and the browser took its pointer
    // capture back. The pointer is still down, so the drag is still the point of this
    // gesture and the note keeps following the pointer.
    loseCapture(board.note(), { x: at.x + 30, y: at.y + 10 });
    expect(board.note().dataset.dragging).toBe('true');

    moveTo(board.note(), { x: at.x + 90, y: at.y + 40 });
    release(board.note(), { x: at.x + 90, y: at.y + 40 });
    await flushFrames();

    const zoom = board.camera().zoom;
    expect(positionOf(board.note())).toEqual({
      x: before.x + 90 / zoom,
      y: before.y + 40 / zoom,
    });
  });

  it('TC-21d: capture lost once the pointer is gone ends the drag and selects the note', async () => {
    const at = board.screenOf(NOTE_CENTRE);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 30, y: at.y + 10 });
    await flushFrames();

    // The pointer itself is gone (buttons: 0): the same ending as a cancel.
    loseCapture(board.note(), { x: at.x + 30, y: at.y + 10 }, { buttons: 0 });
    await flushFrames();

    const placed = positionOf(board.note());
    expect(board.note().dataset.dragging).toBe('false');
    expect(board.note().dataset.selected).toBe('true');

    // It is a selected note now, not a drag that never ended.
    moveTo(board.note(), { x: at.x + 400, y: at.y + 300 });
    await flushFrames();
    expect(positionOf(board.note())).toEqual(placed);
  });

  it('TC-21b: a drag that ends on the pointer keeps the position under the pointer', async () => {
    const before = positionOf(board.note());
    const at = board.screenOf(NOTE_CENTRE);
    press(board.note(), at);
    moveTo(board.note(), { x: at.x + 50, y: at.y + 10 });
    // Release without letting a frame run first: the note must still land where the
    // pointer stopped, not one frame behind it.
    release(board.note(), { x: at.x + 50, y: at.y + 10 });
    await flushFrames();

    expect(positionOf(board.note())).toEqual({ x: before.x + 50, y: before.y + 10 });
  });
});

describe('sticky.interaction: deselect (TC-22)', () => {
  it('TC-22: a click on empty board space deselects and hides the toolbar', async () => {
    const board = await mountSticky();
    seedNote(board);
    await flushFrames();

    clickAt(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();
    expect(board.note().dataset.selected).toBe('true');
    expect(board.toolbarOrNull()).not.toBeNull();

    // Empty space: far from the note, on the board itself.
    clickAt(board.board, board.screenOf({ x: 900, y: 600 }));
    await flushFrames();

    expect(board.note().dataset.selected).toBe('false');
    expect(board.toolbarOrNull()).toBeNull();
  });

  it('TC-22b: panning the board does not count as a click and keeps the selection', async () => {
    const board = await mountSticky();
    seedNote(board);
    await flushFrames();
    clickAt(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();

    await dragWithPointer(board.board, board.screenOf({ x: 500, y: 500 }), board.screenOf({ x: 700, y: 600 }));

    expect(board.note().dataset.selected).toBe('true');
    expect(board.camera().zoom).toBe(1);
  });
});

describe('sticky.interaction: keyboard delete (TC-25)', () => {
  it.each([['Delete'], ['Backspace']])('TC-25: %s removes the selected note', async (key) => {
    const board = await mountSticky();
    const id = seedNote(board);
    await flushFrames();

    clickAt(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();
    pressKey(key);
    await flushFrames();

    expect(board.notes()).toHaveLength(0);
    expect(board.noteCount()).toBe(0);
    expect(getStickyText(board.doc, id)).toBeUndefined();
  });

  it('TC-25b: Delete does nothing when no note is selected', async () => {
    const board = await mountSticky();
    seedNote(board);
    await flushFrames();

    pressKey('Delete');
    await flushFrames();

    expect(board.notes()).toHaveLength(1);
  });

  it('TC-25c: the second note stays when one of two is deleted', async () => {
    const board = await mountSticky();
    const first = seedNote(board, { x: 0, y: 0 });
    const second = seedNote(board, { x: 400, y: 0 });
    await flushFrames();

    clickAt(board.note(1), board.screenOf({ x: 400, y: 0 }));
    await flushFrames();
    pressKey('Delete');
    await flushFrames();

    expect(board.notes().map((note) => note.id)).toEqual([first]);
    expect(second).toBeTruthy();
  });
});

describe('sticky.interaction: double-click and Enter (TC-35, TC-36)', () => {
  it('TC-35: double-clicking a note edits it instead of adding another', async () => {
    const board = await mountSticky();
    seedNote(board);
    await flushFrames();

    doubleClick(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();

    expect(board.noteCount()).toBe(1);
    expect(board.editorOrNull()).not.toBeNull();
    expect(board.note().dataset.selected).toBe('true');
    // The note is not the board's surface, so no note appears at the double-click point.
    expect(board.notes()[0]?.x).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it('TC-36: Enter with nothing selected creates and edits nothing', async () => {
    const board = await mountSticky();

    pressKey('Enter');
    await flushFrames();

    expect(board.notes()).toHaveLength(0);
    expect(board.editorOrNull()).toBeNull();
  });

  it('TC-36b: Enter on a selected note starts editing it', async () => {
    const board = await mountSticky();
    seedNote(board);
    await flushFrames();

    clickAt(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();
    pressKey('Enter');
    await flushFrames();

    expect(board.noteCount()).toBe(1);
    expect(board.editorOrNull()).not.toBeNull();
  });

  it('TC-36c: a note added by double-click is centred on the point and on top', async () => {
    const board = await mountSticky();
    const world = { x: 120, y: -80 };
    const id = await doubleClickBoard(board, world);
    await flushFrames();

    const note = board.notes().find((candidate) => candidate.id === id);
    expect(note?.x).toBe(world.x - STICKY_SIZE_WORLD / 2);
    expect(note?.y).toBe(world.y - STICKY_SIZE_WORLD / 2);
    expect(centreOf(board.note())).toEqual(world);
    expect(board.editorOrNull()).not.toBeNull();
  });
});

describe('sticky.interaction: the note disappears mid-interaction (TC-37)', () => {
  it('TC-37: a note deleted during a drag ends the drag silently', async () => {
    const board = await mountSticky();
    const id = seedNote(board);
    await flushFrames();

    const at = board.screenOf(NOTE_CENTRE);
    const note = board.note();
    press(note, at);
    moveTo(note, { x: at.x + 40, y: at.y });
    await flushFrames();

    deleteObject(board.doc, id);
    await flushFrames();
    expect(board.noteCount()).toBe(0);

    // The pointer keeps moving and lets go over the board; nothing is thrown and the note
    // is not brought back by the drag that was still in progress.
    expect(() => {
      moveTo(note, { x: at.x + 90, y: at.y + 20 });
      release(note, { x: at.x + 90, y: at.y + 20 });
    }).not.toThrow();
    await flushFrames(3);

    expect(board.noteCount()).toBe(0);
    expect(board.notes()).toEqual([]);
  });

  it('TC-37b: a note deleted while being edited leaves the board without it', async () => {
    const board = await mountSticky();
    const id = seedNote(board);
    await flushFrames();
    doubleClick(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();

    deleteObject(board.doc, id);
    await flushFrames();

    expect(board.noteCount()).toBe(0);
    expect(board.editorOrNull()).toBeNull();
    // A keystroke arriving after the delete does not resurrect the note.
    expect(() => pressKey('x')).not.toThrow();
    await flushFrames();
    expect(board.notes()).toHaveLength(0);
  });

  it('TC-37c: a note deleted from a peer while selected hides its toolbar', async () => {
    const board = await mountSticky();
    const id = seedNote(board);
    await flushFrames();
    clickAt(board.note(), board.screenOf(NOTE_CENTRE));
    await flushFrames();
    expect(board.toolbarOrNull()).not.toBeNull();

    deleteObject(board.doc, id);
    await flushFrames();

    expect(board.toolbarOrNull()).toBeNull();
    expect(board.noteCount()).toBe(0);
  });
});
