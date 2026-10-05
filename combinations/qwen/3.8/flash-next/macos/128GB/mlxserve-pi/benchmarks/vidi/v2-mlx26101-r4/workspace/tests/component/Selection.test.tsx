/**
 * Selecting several objects at once, and being told what is selected (TC-16 to TC-22).
 *
 * What this file is mostly about is *agreement*: the outlines, the count in the bar, the number that is
 * read out and the objects in the document have to all say the same thing at the same time, because a
 * selection that disagrees with itself — an outline left on a note somebody else deleted, a bar that
 * counted a note that is no longer there — is the failure this story exists to prevent, and it is not
 * visible in a screenshot, only in the moment a person acts on the wrong number.
 *
 * Two tests are about objects that are not sticky notes. One of them is a type the test suite registers
 * (a testbox), and one is a type nobody has ever registered, which is what a board will contain the
 * moment a later story writes something new into an old document. The board has to be right about both.
 *
 * Positions in these tests are screen points, because that is what a pointer is given: the board area in
 * jsdom is 1024x768 and opens framed on its centre, so a note made at (250, 250) is drawn with its middle
 * there and covers 200x200 pixels from (150, 150). `helpers/selection.ts` does that arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { HANDLES, HANDLE_LABELS } from '../../src/shared/geometry';
import { createSticky } from '../../src/shared/board-model';
import {
  addLockbox,
  addTestbox,
  addUnknownType,
  around,
  boundingBoxOnScreen,
  beginMarquee,
  cameraOf,
  cancelWindow,
  deleteSelectionButton,
  doc,
  endMarquee,
  escapeDuringMarquee,
  handleLabels,
  liveText,
  marquee,
  marqueeAround,
  marqueeVisible,
  MIDDLE,
  LOCKBOX_TYPE,
  noteToolbarVisible,
  objectById,
  outlinedIds,
  placeNote,
  pressEscape,
  pressNote,
  renderBoard,
  screenRect,
  screenToWorld,
  selectAll,
  selectionBarVisible,
  selectionText,
  somebodyElse,
  surface,
  TESTBOX_TYPE,
  zoomOutByKeyboard,
} from './helpers/selection';

/** Delete an object the way a colleague does: in the document, with nobody holding a pointer. */
function deleteRemotely(id: string): void {
  act(() => {
    doc().transact(() => {
      doc().getMap<Y.Map<unknown>>('objects').delete(id);
    }, 'remote');
  });
}

describe('every object type is selected the same way', () => {
  it('TC-16: an object of another registered type is drawn by the board and selected like anything else', async () => {
    renderBoard();
    const stickyId = await placeNote({ x: 250, y: 250 });
    const boxId = addTestbox({ x: 200, y: 200, width: 300, height: 100 });

    // Drawn by the type's own component, in the board's own coordinates, under the type name the
    // fixture registered it under — which is the only reason the board knows to draw it at all.
    const box = screen.getByTestId('testbox');
    expect(box.dataset.noteId).toBe(boxId);
    expect(objectById(boxId).type).toBe(TESTBOX_TYPE);

    // Pressing it selects it, through the same one mechanism a note uses. The outline is drawn by the
    // selection rather than by the object, which is why a type added by a later story needs no selection
    // code of its own and cannot disagree with the board about what is chosen.
    pressNote(boxId);
    await waitFor(() => expect(outlinedIds()).toEqual([boxId]));
    expect(box.dataset.selected).toBe('true');
    expect(screen.getByTestId('selection-bounds')).not.toBeNull();

    // And it moves with the keyboard like anything else, because the keyboard works on ids.
    pressEscape();
    selectAll();
    expect(outlinedIds().sort()).toEqual([boxId, stickyId].sort());
  });

  it('TC-16b: an object of a type nothing has registered is left alone, not guessed at', async () => {
    renderBoard();
    const stickyId = await placeNote({ x: 250, y: 250 });
    addUnknownType('unknown-1', 600, 600);

    // Nothing is drawn for it: a board must not draw an object it does not know, and must not draw it as
    // a sticky note, which would be a lie about somebody's board.
    expect(document.querySelectorAll('[data-note-id]')).toHaveLength(1);
    expect(screen.queryByTestId('testbox')).toBeNull();

    // And this build leaves it alone: select-all does not reach it, so nothing can be moved or deleted
    // out from under the story that knows what it is. The bytes are the other build's to look after.
    selectAll();
    expect(outlinedIds()).toEqual([stickyId]);
    expect(selectionText()).toBeNull();
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-17: two selected objects are counted in words, with one delete for all of them', async () => {
    renderBoard();
    const first = await placeNote({ x: 250, y: 250 }, 'one');
    const second = await placeNote({ x: 650, y: 250 }, 'two');

    selectAll();

    expect(selectionText()).toBe('2 selected');
    expect(deleteSelectionButton()).not.toBeNull();
    // Spoken as well as shown, because the bar is only readable by somebody who can see the board.
    expect(liveText()).toBe('2 selected');
    // Exactly one control set: the note's own toolbar is about *a* note, and there is no colour that
    // means "these two".
    expect(noteToolbarVisible()).toBe(false);
    expect(outlinedIds().sort()).toEqual([first, second].sort());
  });

  it('TC-17b: the count is of objects that are still on the board', async () => {
    renderBoard();
    const first = await placeNote({ x: 250, y: 250 });
    const second = await placeNote({ x: 650, y: 250 });
    const third = await placeNote({ x: 250, y: 600 });
    selectAll();
    expect(selectionText()).toBe('3 selected');

    // A colleague deletes one of the three. The selection loses that id, and the bar counts what is left:
    // three outlines and a bar saying "3 selected" would be a bar wrong about the board.
    deleteRemotely(third);
    await waitFor(() => expect(outlinedIds().sort()).toEqual([first, second].sort()));
    expect(selectionText()).toBe('2 selected');

    deleteRemotely(second);
    // One object left: the note's own toolbar is the control now, and the selection bar has gone.
    await waitFor(() => expect(selectionBarVisible()).toBe(false));
    await waitFor(() => expect(noteToolbarVisible()).toBe(true));
    expect(liveText()).toBeNull();
  });

  it('TC-18: each selected object has its own outline, and one box with eight handles is drawn around them', async () => {
    renderBoard();
    const first = await placeNote({ x: 250, y: 250 });
    const second = await placeNote({ x: 650, y: 600 });
    selectAll();

    // Per-object outlines, not one shape covering the pair: which objects are in is the question a person
    // is asking, and a bounding box alone cannot answer it.
    expect(outlinedIds().sort()).toEqual([first, second].sort());
    const outline = screen.getAllByTestId('selection-outline')[0].style;
    expect(outline.left).toBe(`${screenRect(objectById(first)).x}px`);

    // One box around the pair, big enough to hold both.
    const box = boundingBoxOnScreen();
    const a = screenRect(objectById(first));
    const b = screenRect(objectById(second));
    expect(box.x).toBe(Math.min(a.x, b.x));
    expect(box.y).toBe(Math.min(a.y, b.y));
    expect(box.width).toBe(Math.max(a.x + a.width, b.x + b.width) - box.x);
    expect(box.height).toBe(Math.max(a.y + a.height, b.y + b.height) - box.y);

    // Eight handles, each named for the place it resizes from, each a fixed size on the screen.
    expect(handleLabels().sort()).toEqual(HANDLES.map((handle) => HANDLE_LABELS[handle]).sort());
    expect(screen.getByTestId('resize-handle-se').style.width).toBe('8px');
  });

  it('TC-18b: a selection that includes a type which cannot be resized shows no handles at all', async () => {
    renderBoard();
    const stickyId = await placeNote({ x: 250, y: 250 });
    const boxId = addTestbox({ x: 600, y: 200, width: 200, height: 120 });

    // Both types know how to resize, so the handles are there.
    selectAll();
    expect(handleLabels()).toHaveLength(HANDLES.length);

    // Add an object of a type that cannot be resized. Hiding its own handles would leave half a control,
    // and leaving all of them showing would offer an action that cannot be carried out — the box can be
    // made bigger than the lockbox allows, and then what? So the whole selection loses them, and keeps
    // everything else: the objects are still selected, still moveable, still deletable.
    const locked = addLockbox({ x: 100, y: 500, width: 160, height: 90 });
    expect(objectById(locked).type).toBe(LOCKBOX_TYPE);
    selectAll();
    expect(outlinedIds().sort()).toEqual([locked, stickyId, boxId].sort());
    expect(handleLabels()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bounds')).not.toBeNull();
    expect(selectionText()).toBe('3 selected');

    // Choose the lockbox on its own and the handles are gone for it alone; choose the two that can be
    // resized and they come back. The rule is per-selection, not per-board.
    pressNote(locked);
    expect(outlinedIds()).toEqual([locked]);
    expect(handleLabels()).toHaveLength(0);

    pressNote(stickyId, { ctrlKey: true });
    expect(outlinedIds().sort()).toEqual([locked, stickyId].sort());
    expect(handleLabels()).toHaveLength(0);

    pressNote(boxId, { ctrlKey: true });
    expect(outlinedIds().sort()).toEqual([boxId, locked, stickyId].sort());
  });

  it('TC-18c: nothing is drawn when nothing is selected, or when what was selected has gone', async () => {
    renderBoard();
    expect(screen.queryByTestId('selection-overlay')).toBeNull();

    const id = await placeNote({ x: 250, y: 250 });
    expect(outlinedIds()).toEqual([id]);

    deleteRemotely(id);
    // No outline is left behind on an object that is not on the board — the most conspicuous way for a
    // selection to be wrong, and prevented by the selection holding ids rather than objects.
    await waitFor(() => expect(outlinedIds()).toEqual([]));
    expect(screen.queryByTestId('selection-bounds')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('the rectangle that selects', () => {
  it('TC-19: a rectangle over empty board space selects what is fully inside it and nothing else', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    await placeNote({ x: 650, y: 250 });
    await placeNote({ x: 250, y: 600 });
    // Start from nothing chosen.
    pressEscape();
    expect(outlinedIds()).toEqual([]);

    // From an empty corner, far enough to hold A whole. B sticks out of the right edge and C out of the
    // bottom, and an object that is only partly inside is not inside.
    marquee({ x: 130, y: 130 }, { x: 600, y: 600 }, surface());

    expect(outlinedIds()).toEqual([a]);
    expect(selectionText()).toBeNull();
  });

  it('TC-19b: the rectangle is drawn in screen units, so it keeps its shape at any zoom', async () => {
    renderBoard();
    await placeNote(MIDDLE);
    pressEscape();

    // Zoom the board out with the board's own keystroke, so a board-unit rectangle and a screen rectangle
    // are now different sizes and the drawing has to be the screen one.
    zoomOutByKeyboard();
    await waitFor(() => expect(cameraOf().zoom).toBeCloseTo(1 / ZOOM_STEP_FACTOR, 6));

    beginMarquee({ x: 130, y: 130 }, { x: 400, y: 400 });
    const rectangle = screen.getByTestId('marquee');
    expect(rectangle.style.left).toBe('130px');
    expect(rectangle.style.top).toBe('130px');
    // The pointer travelled 270 pixels, and the box is 270 pixels wide — which is what "held in board
    // units, drawn in screen units" means: had it been held in pixels and scaled again on the way out,
    // as an earlier draft of this did, it would have come back 20% smaller than the drag that made it.
    expect(parseFloat(rectangle.style.width)).toBeCloseTo(270, 3);
    expect(parseFloat(rectangle.style.height)).toBeCloseTo(270, 3);
    endMarquee({ x: 400, y: 400 });
  });

  it('TC-20: the rectangle adds to what was already selected when it is let go', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    const c = await placeNote({ x: 250, y: 600 });
    const d = await placeNote({ x: 650, y: 600 });
    pressEscape();

    // One note chosen by hand.
    pressNote(a);
    expect(outlinedIds()).toEqual([a]);

    // A rectangle around a second one adds it without dropping the first: a person who has already chosen
    // something does not mean to lose it by drawing near something else.
    marquee({ x: 530, y: 480 }, { x: 770, y: 720 }, surface());
    expect(outlinedIds().sort()).toEqual([a, d].sort());
    expect(selectionText()).toBe('2 selected');

    // And rectangles over the other two finish with all four chosen.
    marqueeAround(around(objectById(b), 30), surface());
    marqueeAround(around(objectById(c), 30), surface());
    expect(outlinedIds().sort()).toEqual([a, b, c, d].sort());
    expect(selectionText()).toBe('4 selected');
  });

  it('TC-21: a rectangle over nothing leaves the selection exactly as it was', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });

    // The gap between the notes holds no object at all, and letting go over an empty rectangle is not a
    // request to deselect: the additive select simply has nothing to add.
    marquee({ x: 380, y: 380 }, { x: 520, y: 470 }, surface());
    expect(outlinedIds()).toEqual([a]);
  });

  it('TC-22: Escape gives the rectangle up without selecting, and does not empty the selection', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    await placeNote({ x: 650, y: 250 });
    pressNote(a);
    expect(outlinedIds()).toEqual([a]);

    // A rectangle is in flight, with the other note inside it.
    beginMarquee({ x: 530, y: 130 }, { x: 770, y: 370 });
    expect(marqueeVisible()).toBe(true);

    // Escape means "not that", and nothing else. It must not select what the rectangle was sitting on,
    // and it must not reach the board's Escape, whose job is to empty the selection.
    pressEscape(document.body);

    expect(marqueeVisible()).toBe(false);
    expect(outlinedIds()).toEqual([a]);
  });

  it('TC-22b: a rectangle the pointer was taken away from selects nothing', async () => {
    renderBoard();
    await placeNote({ x: 250, y: 250 });
    await placeNote({ x: 650, y: 250 });
    pressEscape();
    expect(outlinedIds()).toEqual([]);

    beginMarquee({ x: 130, y: 130 }, { x: 600, y: 600 });
    expect(marqueeVisible()).toBe(true);
    // The pointer was taken — a system gesture, a window that lost focus. That is not a selection.
    cancelWindow({ x: 600, y: 600 });

    expect(marqueeVisible()).toBe(false);
    expect(outlinedIds()).toEqual([]);
  });

  it('TC-22c: drawing a rectangle does not move the board', async () => {
    renderBoard();
    await placeNote({ x: 250, y: 250 });
    pressEscape();
    const before = cameraOf();

    marquee({ x: 130, y: 130 }, { x: 600, y: 600 }, surface());

    // Shift on empty space is a rectangle and not a pan. Story 1's drag is untouched by this story, and
    // the two cannot be confused because the modifier is checked before either of them begins.
    expect(cameraOf()).toEqual(before);
  });

  it('TC-22d: a rectangle drawn over an object that appears during the drag selects it', async () => {
    renderBoard();
    const elsewhere = await placeNote({ x: 850, y: 650 });
    pressEscape();
    expect(outlinedIds()).toEqual([]);

    // Press, drag out over the empty area, and only then does a colleague put a note there. The rectangle
    // asks about the board at the moment the pointer lets go, not at the moment it was pressed: an object
    // that appeared in the middle of the drag is one the person could see they were drawing round.
    beginMarquee({ x: 130, y: 130 }, { x: 370, y: 370 });
    let appeared = '';
    somebodyElse((there) => {
      appeared = createSticky(there, screenToWorld(cameraOf(), { x: 250, y: 250 }));
    });
    expect(outlinedIds()).toEqual([]);

    endMarquee({ x: 370, y: 370 });
    expect(outlinedIds()).toEqual([appeared]);
    expect(outlinedIds()).not.toContain(elsewhere);
  });

  it('TC-22e: Escape gives up a rectangle in flight and leaves the choice as it was', async () => {
    renderBoard();
    const first = await placeNote({ x: 250, y: 250 });
    const second = await placeNote({ x: 700, y: 600 });
    pressEscape();

    // Both notes are chosen first, so the two meanings of Escape can be told apart: giving the rectangle
    // up leaves the two of them chosen, while the same key with no rectangle in flight empties the
    // selection. A rectangle is not a selection to empty.
    selectAll();
    // Compared as sets: the board paints notes in the order they were made, and two notes made in the
    // same millisecond are ordered by their id, which is not an order a test can predict.
    expect([...outlinedIds()].sort()).toEqual([first, second].sort());
    beginMarquee({ x: 130, y: 130 }, { x: 900, y: 700 });
    expect(marqueeVisible()).toBe(true);

    escapeDuringMarquee();

    expect(marqueeVisible()).toBe(false);
    expect([...outlinedIds()].sort()).toEqual([first, second].sort());

    // And a rectangle drawn afterwards does choose, so Escape has not switched the rectangle off.
    const third = await placeNote({ x: 250, y: 600 });
    marquee({ x: 130, y: 480 }, { x: 400, y: 720 }, surface());
    expect(outlinedIds()).toEqual([third]);
  });
});
