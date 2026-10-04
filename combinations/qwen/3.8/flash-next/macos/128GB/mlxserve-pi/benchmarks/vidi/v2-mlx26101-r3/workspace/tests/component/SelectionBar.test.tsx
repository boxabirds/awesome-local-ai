import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fireEvent, screen } from '@testing-library/react';
import { flushFrames } from './helpers';
import {
  centreOnScreen,
  clickAt,
  shiftPress,
  mountSticky,
  press,
  release,
  type MountedSticky,
} from './helpers/sticky';
import {
  OBJECTS_MAP,
  createSticky,
  deleteObjects,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/**
 * The selection bar (TC-16 to TC-19): what it says, when it appears, and when it goes away.
 *
 * The bar is the only place story 7 tells the user how many objects they are about to affect, so
 * the tests read it as a person reads it - a number, and one button - and then check the number
 * against the document rather than against the app's own arithmetic. A count that came out of
 * the selection would agree with the selection no matter how wrong it was.
 *
 * Three notes are laid out far enough apart that a press meant for one cannot land on another:
 * each is `STICKY_SIZE_WORLD` across, and they are 300 units apart.
 */

const A = { x: -400, y: -100 };
const B = { x: -100, y: -100 };
const C = { x: 300, y: 200 };

/** An empty stretch of board, in world units, that no note is drawn over. */
const EMPTY_SPACE = { x: -540, y: 300 };

let ids: string[] = [];

function seedThree(board: MountedSticky): void {
  for (const at of [A, B, C]) {
    ids.push(createSticky(board.doc, at));
  }
}

/** Press a note, which selects it and nothing else. */
function select(board: MountedSticky, index: number): void {
  const object = board.object(ids[index]!);
  clickAt(board.box(index), centreOnScreen(board, object));
}

/** Shift + press a note, which adds it to the selection. */
function addToSelection(board: MountedSticky, index: number): void {
  const object = board.object(ids[index]!);
  shiftPress(board.box(index), centreOnScreen(board, object));
}

describe('sel.interaction: the selection bar (TC-17, TC-18)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    ids = [];
    board = await mountSticky();
    seedThree(board);
    await flushFrames();
  });

  it('TC-17: two selected says "2 selected" and offers one Delete', async () => {
    select(board, 0);
    await flushFrames();
    // One object selected: the note's own toolbar answers for it, and there is no bar.
    expect(board.barOrNull()).toBeNull();

    addToSelection(board, 1);
    await flushFrames();

    expect(board.barText()).toBe('2 selected');
    expect(board.outlineCount()).toBe(2);
    expect(board.outlinedIds().sort()).toEqual([ids[0], ids[1]].sort());
    const bar = board.bar();
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.getAttribute('aria-label')).toBe('Selection');
    // The count is in a live region, because the number is asked while looking at the board.
    const count = screen.getByTestId('selection-count');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.textContent).toBe('2 selected');
    // The button is named, and named for what it does to the whole selection.
    const remove = board.barDelete();
    expect(remove.getAttribute('aria-label')).toBe('Delete selection');
  });

  it('TC-17b: the bar counts what is on the board, not what was clicked', async () => {
    select(board, 0);
    addToSelection(board, 1);
    addToSelection(board, 2);
    await flushFrames();
    expect(board.barText()).toBe('3 selected');

    // A colleague deletes one of the three; the bar says two because two are there to count.
    deleteObjects(board.doc, [ids[1]!]);
    await flushFrames();
    expect(board.barText()).toBe('2 selected');
    expect(board.outlinedIds()).not.toContain(ids[1]);
    expect(board.outlineCount()).toBe(2);
  });

  it('TC-17c: its Delete takes the whole selection in one go', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();

    fireEvent.click(board.barDelete());
    await flushFrames();

    expect(snapshot(board.doc).map((object) => object.id)).toEqual([ids[2]]);
    expect(board.barOrNull()).toBeNull();
    expect(board.outlineCount()).toBe(0);
    // The note that survived is not selected either, so its own toolbar is away too.
    expect(board.toolbarOrNull()).toBeNull();
  });

  it('TC-17d: the bar is a control, so pressing it neither pans nor plants a note', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    const bar = board.bar();
    expect(bar.closest('[data-board-ui]')).not.toBeNull();

    press(bar, { x: 600, y: 20 });
    const cameraBefore = board.camera();
    expect(board.board.dataset.panning).toBe('false');
    release(bar, { x: 900, y: 20 });
    await flushFrames();
    expect(board.camera()).toEqual(cameraBefore);

    const before = snapshot(board.doc).length;
    fireEvent.doubleClick(bar);
    await flushFrames();
    expect(snapshot(board.doc)).toHaveLength(before);
  });

  it('TC-18: one selected gets the note toolbar instead of a bar', async () => {
    select(board, 0);
    await flushFrames();

    expect(board.barOrNull()).toBeNull();
    expect(board.toolbarOrNull()).not.toBeNull();
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    // One outline, one object selected, and no resize box drawn around a single note.
    expect(board.outlineCount()).toBe(1);
    expect(board.boundsOrNull()).toBeNull();
    // ...but it does have handles: one note is still something you can resize.
    expect(board.handleList()).toHaveLength(8);
  });

  it('TC-18b: the bar comes back the moment there are two again, and goes with the second', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    expect(board.barOrNull()).not.toBeNull();

    // Shift + press the second one again: it leaves the selection, and the bar with it.
    addToSelection(board, 1);
    await flushFrames();
    expect(board.barOrNull()).toBeNull();
    expect(board.outlineCount()).toBe(1);
    expect(board.toolbarOrNull()).not.toBeNull();
  });

  it('TC-18c: an object of a type the board cannot draw is neither counted nor outlined', async () => {
    // What a newer board left behind stays out of the selection's arithmetic: it has no
    // component to draw, so there is nothing to click, nothing to outline and nobody to count.
    board.doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set('type', 'frame');
      shape.set('x', A.x);
      shape.set('y', A.y);
      shape.set('width', 400);
      shape.set('height', 400);
      shape.set('z', 99);
      board.doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).set('frame-1', shape);
    });
    await flushFrames();

    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();

    expect(board.barText()).toBe('2 selected');
    expect(board.outlinedIds()).not.toContain('frame-1');
    expect(board.objects().some((object) => object.id === 'frame-1')).toBe(false);
    // And the marquee cannot pick it up either, so it never reaches the count at all.
    expect(board.elementsOf('frame')).toHaveLength(0);
  });
});

describe('sel.interaction: an empty press, and a selection that vanishes (TC-16, TC-19)', () => {
  let board: MountedSticky;

  beforeEach(async () => {
    ids = [];
    board = await mountSticky();
    seedThree(board);
    await flushFrames();
  });

  it('TC-19: a press on empty board space without a drag clears the selection', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    expect(board.barText()).toBe('2 selected');

    clickAt(board.board, board.screenOf(EMPTY_SPACE));
    await flushFrames();

    expect(board.barOrNull()).toBeNull();
    expect(board.outlineCount()).toBe(0);
    expect(board.note(0).dataset.selected).toBe('false');
  });

  it('TC-19b: the press that clears is a press on the board, not on a note', async () => {
    select(board, 0);
    await flushFrames();
    // A press on the already-selected note selects it again - which is what "select it and only
    // it" means - and does not clear the selection out from under the pointer.
    select(board, 0);
    await flushFrames();
    expect(board.outlineCount()).toBe(1);
  });

  it('TC-16: when a colleague deletes everything that was selected, the bar goes with it', async () => {
    select(board, 0);
    addToSelection(board, 1);
    addToSelection(board, 2);
    await flushFrames();
    expect(board.barText()).toBe('3 selected');

    deleteObjects(board.doc, ids);
    await flushFrames();

    expect(board.barOrNull()).toBeNull();
    expect(board.outlineCount()).toBe(0);
    expect(board.handleList()).toHaveLength(0);
    expect(board.noteCount()).toBe(0);
    // Nothing is left in the selection to be deleted by the bar's button, either.
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it('TC-16b: and the note being typed into leaves the selection when it is deleted remotely', async () => {
    select(board, 0);
    addToSelection(board, 1);
    await flushFrames();
    fireEvent.keyDown(board.note(0), { key: 'Enter' });
    await flushFrames();

    deleteObjects(board.doc, [ids[0]!]);
    await flushFrames();

    expect(board.editorOrNull()).toBeNull();
    // The other note is still selected, so the bar is still there, now saying one - which is not
    // two, so the bar is gone and the note's own toolbar has taken over again.
    expect(board.barOrNull()).toBeNull();
    expect(board.outlineCount()).toBe(1);
  });

  it('TC-16c: selecting nothing twice is not an error, and the board stays as it was', async () => {
    const before = JSON.stringify(snapshot(board.doc));
    clickAt(board.board, board.screenOf(EMPTY_SPACE));
    clickAt(board.board, board.screenOf(EMPTY_SPACE));
    await flushFrames();
    expect(board.barOrNull()).toBeNull();
    expect(JSON.stringify(snapshot(board.doc))).toBe(before);
  });

  it('TC-19c: a press on a note selects it where it is, at the size it is', async () => {
    // The outline is drawn from the object, so it is the note's box and not a guess at one.
    select(board, 0);
    await flushFrames();
    const outline = screen.getByTestId('selection-outline');
    expect(outline.style.left).toBe(`${A.x - STICKY_SIZE_WORLD / 2}px`);
    expect(outline.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(outline.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(outline.getAttribute('data-object-id')).toBe(ids[0]);
  });
});
