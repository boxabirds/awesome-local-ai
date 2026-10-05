/**
 * Moving, resizing and raising a selection (TC-23 to TC-26, plus the Shift-click that builds one).
 *
 * What is interesting about a group gesture is not that objects move but that they move *together*: the
 * layout inside the selection has to survive, the group has to end up above the objects that were left
 * behind, and an object somebody else deleted halfway through must not be pushed back onto the board by
 * the drag that was already holding it.
 *
 * Distances in this file are screen pixels, because that is what a pointer is moved in, and the board is
 * drawn at zoom 1 in jsdom, so one pixel of pointer travel is one board unit of object travel: a drag of
 * 100 pixels is a move of 100 units. Object positions are read out of the document, which is the only
 * place "did it move" can be answered — a note can look as if it moved and have been written back to the
 * same numbers.
 */
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';

import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import {
  addTestbox,
  around,
  dragHandle,
  dragObject,
  marqueeAround,
  moveWindow,
  noteElementById,
  objectById,
  objects,
  outlinedIds,
  placeNote,
  pressEscape,
  pressNote,
  pressOn,
  renderBoard,
  screenRect,
  selectAll,
  somebodyElse,
  surface,
  TESTBOX_MIN_SIZE_WORLD,
  upWindow,
} from './helpers/selection';

interface Where {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

/** Where one object is, in board units, as a plain object so that a failing diff reads as a sentence. */
function at(id: string): Where {
  const object = objectById(id);
  return { x: object.x, y: object.y, width: object.width, height: object.height, z: object.z };
}

/** The whole board, by id. Comparing whole boards is what catches the note that moved by accident. */
function board(): Map<string, Where> {
  return new Map(objects().map((object) => [object.id, at(object.id)]));
}

const ANY_ORDER = expect.any(Number);

describe('moving a selection', () => {
  it('TC-13b: Shift-click adds an object to the selection and Shift-clicks it back out', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    const c = await placeNote({ x: 250, y: 600 });
    pressEscape();
    expect(outlinedIds()).toEqual([]);
    const was = board();

    // A plain click chooses that object and no other.
    pressNote(b);
    expect(outlinedIds()).toEqual([b]);

    // Shift-clicks add, and leave whatever was already chosen alone.
    pressNote(a, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, b].sort());
    pressNote(c, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, b, c].sort());

    // A Shift-click on one that is already in takes only that one out.
    pressNote(b, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, c].sort());

    // Ctrl/Cmd does the same, the way the board's other selection keys do.
    pressNote(b, { ctrlKey: true });
    expect(outlinedIds().sort()).toEqual([a, b, c].sort());

    // Adding to a selection is a statement about the selection, not a shove: no object moved, and none
    // was raised, because a person adding a fifth note did not ask for it to jump in front of the others.
    expect(board()).toEqual(was);
  });

  it('TC-23: pressing an object that is not selected chooses it alone, and drags only it', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'a');
    const b = await placeNote({ x: 650, y: 250 }, 'b');
    const c = await placeNote({ x: 250, y: 600 }, 'c');
    pressEscape();

    // A and C are chosen and B is not: the state a person is actually in when they grab something else.
    marqueeAround(around(objectById(a), 30), surface());
    marqueeAround(around(objectById(c), 30), surface());
    expect(outlinedIds().sort()).toEqual([a, c].sort());

    const was = board();
    dragObject(b, 60, 0);

    // Pressing B chose B alone — A and C are no longer selected — and only B moved. Two notes sliding
    // aside because somebody picked up a third is the failure this is about.
    await waitFor(() => expect(outlinedIds()).toEqual([b]));
    await waitFor(() => expect(objectById(b).x).toBe(was.get(b)!.x + 60));
    expect(board().get(b)).toEqual({ ...was.get(b)!, x: was.get(b)!.x + 60, z: ANY_ORDER });
    expect(board().get(a)).toEqual(was.get(a));
    expect(board().get(c)).toEqual(was.get(c));
  });

  it('TC-24: dragging one object of a selection moves all of them, keeps their layout, raises them', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'a');
    const b = await placeNote({ x: 650, y: 250 }, 'b');
    const c = await placeNote({ x: 250, y: 600 }, 'c');
    selectAll();
    expect(outlinedIds()).toHaveLength(3);

    // A colleague adds a note while the selection is held. It is not part of the selection, so it is the
    // one the selection has to end up above.
    let other = '';
    somebodyElse((there) => {
      other = createSticky(there, { x: 900, y: 700 });
    });
    await waitFor(() => expect(objects()).toHaveLength(4));

    const was = board();
    dragObject(a, 100, 50);

    // Every object in the selection moved by the same distance. Three notes moved by three different
    // amounts are three notes in a new order, which is the one thing a group move must not do.
    await waitFor(() => expect(objectById(c).y).toBe(was.get(c)!.y + 50));
    for (const id of [a, b, c]) {
      expect(board().get(id)).toEqual({ ...was.get(id)!, x: was.get(id)!.x + 100, y: was.get(id)!.y + 50, z: ANY_ORDER });
    }
    // The distances inside the selection are the ones they were.
    expect(board().get(b)!.x - board().get(a)!.x).toBe(was.get(b)!.x - was.get(a)!.x);
    expect(board().get(c)!.y - board().get(a)!.y).toBe(was.get(c)!.y - was.get(a)!.y);

    // The note that was not part of it stayed where it was, and the selection is now above it — the
    // selection came forward as a group, keeping the order it already had among itself.
    expect(board().get(other)).toEqual(was.get(other));
    for (const id of [a, b, c]) expect(board().get(id)!.z).toBeGreaterThan(board().get(other)!.z);
    expect(board().get(b)!.z > board().get(a)!.z).toBe(was.get(b)!.z > was.get(a)!.z);
    expect(board().get(c)!.z > board().get(a)!.z).toBe(was.get(c)!.z > was.get(a)!.z);
  });

  it('TC-24b: an object deleted halfway through the drag is not put back by it', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'a');
    const b = await placeNote({ x: 650, y: 250 }, 'b');
    selectAll();
    expect(outlinedIds()).toHaveLength(2);

    const was = at(a);

    // Press on A, start the drag, and have a colleague take B away while the pointer is holding both.
    const centre = pressOn(a);
    moveWindow({ x: centre.x + 30, y: centre.y });
    somebodyElse((there) => {
      there.transact(() => {
        there.getMap('objects').delete(b);
      }, 'remote');
    });
    await waitFor(() => expect(outlinedIds()).toEqual([a]));

    // Let go further along. The note that is left lands where the pointer was left; the one that was
    // deleted is gone, rather than restored at its old place by a drag that had already picked it up.
    moveWindow({ x: centre.x + 80, y: centre.y });
    upWindow({ x: centre.x + 80, y: centre.y });
    await waitFor(() => expect(objectById(a).x).toBe(was.x + 80));
    expect(objects().some((object) => object.id === b)).toBe(false);
    expect(at(a)).toEqual({ ...was, x: was.x + 80, z: ANY_ORDER });
  });

  it('TC-25: resizing a selection of notes keeps each of them square and their layout in proportion', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    selectAll();

    // Two notes 200 units apart on the board, in a bounding box of 600x200 screen pixels.
    const was = board();
    expect(was.get(a)).toEqual({ x: -362, y: -234, width: 200, height: 200, z: ANY_ORDER });
    expect(was.get(b)!.x - (was.get(a)!.x + was.get(a)!.width)).toBe(200);

    // Pull the bottom-right of the whole selection 100 pixels to the right. Nothing was said about shape,
    // so the notes' own nature holds: a sticky note is square, in a group as much as on its own.
    dragHandle('se', 100, 0);
    await waitFor(() => expect(objectById(a).width).toBeGreaterThan(was.get(a)!.width));

    const now = board();
    for (const id of [a, b]) {
      expect(now.get(id)!.width).toBe(now.get(id)!.height);
      expect(now.get(id)!.width).toBeGreaterThan(was.get(id)!.width);
    }
    // The gap between them grew by the same factor as the notes did. A selection that resized its objects
    // by different factors, or left them their own size and moved them apart, fails here.
    const grewBy = now.get(a)!.width / was.get(a)!.width;
    expect((now.get(b)!.x - now.get(a)!.x) / (was.get(b)!.x - was.get(a)!.x)).toBeCloseTo(grewBy, 4);
    // And the box grew away from the corner that was held, so the far corner of the selection did not stir.
    expect(Math.min(now.get(a)!.x, now.get(b)!.x)).toBe(Math.min(was.get(a)!.x, was.get(b)!.x));
    expect(Math.min(now.get(a)!.y, now.get(b)!.y)).toBe(Math.min(was.get(a)!.y, was.get(b)!.y));
  });

  it('TC-24c: an edge handle changes one direction, and Shift holds the proportions', async () => {
    renderBoard();
    await placeNote({ x: 250, y: 250 });
    const boxId = addTestbox({ x: 40, y: -234, width: 300, height: 120 });
    pressEscape();

    pressNote(boxId);
    expect(outlinedIds()).toEqual([boxId]);
    const was = at(boxId);

    // The east handle moves the east edge and nothing else. An edge handle that resized both ways would
    // be a corner handle with a different picture painted on it.
    dragHandle('e', 80, 0);
    await waitFor(() => expect(objectById(boxId).width).toBe(was.width + 80));
    expect(at(boxId)).toEqual({ ...was, width: was.width + 80 });

    // Holding Shift asks for the proportions to be held, whatever the type's own nature, and the board
    // listens: the box gets bigger in both directions by the same factor.
    const before = at(boxId);
    dragHandle('e', 60, 0, { shiftKey: true });
    await waitFor(() => expect(objectById(boxId).width).toBeGreaterThan(before.width));
    expect(at(boxId).width / at(boxId).height).toBeCloseTo(before.width / before.height, 3);
    expect(at(boxId).height).toBeGreaterThan(before.height);
  });

  it('TC-26: a resize stops at the size the object type will allow, and no smaller', async () => {
    renderBoard();
    const id = await placeNote({ x: 250, y: 250 });
    const was = at(id);

    // Drag the top-left corner a long way past the bottom-right. Without a limit the note is told it has
    // no size, or a negative one, which is not a size and is the kind of value that later makes a board
    // impossible to draw.
    dragHandle('nw', 400, 400);
    await waitFor(() => expect(objectById(id).width).toBe(STICKY_MIN_SIZE_WORLD));
    expect(at(id).height).toBe(STICKY_MIN_SIZE_WORLD);

    // It shrank towards the corner that was not held, which is the one that was supposed to stay still.
    expect(at(id).x + at(id).width).toBeCloseTo(was.x + was.width, 3);
    expect(at(id).y + at(id).height).toBeCloseTo(was.y + was.height, 3);

    // The limit belongs to the type rather than to the board: the testbox has its own, smaller minimum,
    // and shrinking it to nothing is refused in the same way.
    const boxId = addTestbox({ x: 40, y: -234, width: 300, height: 120 });
    pressEscape();
    pressNote(boxId);
    const boxWas = at(boxId);
    dragHandle('e', -600, 0);
    await waitFor(() => expect(objectById(boxId).width).toBe(TESTBOX_MIN_SIZE_WORLD));
    expect(at(boxId).height).toBe(boxWas.height);
  });

  it('TC-26b: a press that never became a drag leaves the board untouched', async () => {
    renderBoard();
    const id = await placeNote({ x: 250, y: 250 });
    const was = board();

    // A pointer that goes down and comes up two pixels away is a click. If such a press wrote the
    // object's position, every note on the board would shift a little each time anybody selected it, and
    // two people clicking on the same note would end up arguing about where it is.
    const centre = pressOn(id);
    moveWindow({ x: centre.x + 2, y: centre.y + 1 });
    upWindow({ x: centre.x + 2, y: centre.y + 1 });

    expect(board()).toEqual(was);
    expect(outlinedIds()).toEqual([id]);
    expect(noteElementById(id).dataset.selected).toBe('true');
    expect(screenRect(objectById(id)).x).toBe(150);
  });
});
