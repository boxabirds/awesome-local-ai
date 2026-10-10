// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_THRESHOLD_PX, IMAGE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { LOAD_FAILED_LABEL } from '../../src/client/sync/ConnectionStatus';
import {
  createNote,
  flushFrames,
  noteCentreOnScreen,
  noteElement,
  readCamera,
  renderBoard,
  waitForNotes,
} from './fixtures/board';
import { seedImage } from './fixtures/images';
import { socketsCloseWith, socketsLive } from './fixtures/socket';
import {
  BOX_SEED,
  clickObject,
  dragHandle,
  dragObject,
  handleElement,
  handleElements,
  objectCentreOnScreen,
  objectElement,
  objectInDoc,
  objectRect,
  remoteDelete,
  pointerCancelOn,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  seedBoxes,
  selectionBoxWorld,
  shiftClickObject,
  TESTBOX_MIN_SIZE,
  waitForSelected,
} from './fixtures/selection';

/**
 * The one gesture that moves and resizes objects of every type (sel.transform).
 *
 * Boxes are seeded at world x −580 and −340, y −350, each 200×200 — so at 100% zoom one
 * screen pixel moves an object one world unit, and every expectation below is a whole
 * number.
 */

beforeEach(async () => {
  await renderBoard();
  expect(readCamera().zoom).toBe(1);
});

describe('dragging objects (TC-23)', () => {
  it('TC-23: dragging an unselected object selects it alone and moves only it', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    await dragObject(b, { x: 60, y: 0 });

    await waitForSelected([b]);
    expect(objectRect(b)).toEqual({ ...BOX_SEED[1], x: BOX_SEED[1].x + 60 });
    expect(objectRect(a)).toEqual(BOX_SEED[0]);
  });

  it('TC-23 boundary: a press that moves DRAG_THRESHOLD_PX − 1 is a click and writes nothing', async () => {
    const [a] = await seedBoxes();
    await dragObject(a, { x: DRAG_THRESHOLD_PX - 1, y: 0 }, { steps: 1 });

    expect(objectRect(a)).toEqual(BOX_SEED[0]);
    await waitForSelected([a]);
  });

  it('TC-23 boundary: moving exactly DRAG_THRESHOLD_PX starts the gesture', async () => {
    const [a] = await seedBoxes();
    await dragObject(a, { x: DRAG_THRESHOLD_PX, y: 0 }, { steps: 1 });

    expect(objectRect(a).x).toBe(BOX_SEED[0].x + DRAG_THRESHOLD_PX);
  });

  it('a drag that starts on a selected object moves the whole selection by the same offset', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);

    await dragObject(a, { x: 45, y: -25 });

    expect(objectRect(a)).toEqual({ ...BOX_SEED[0], x: BOX_SEED[0].x + 45, y: BOX_SEED[0].y - 25 });
    expect(objectRect(b)).toEqual({ ...BOX_SEED[1], x: BOX_SEED[1].x + 45, y: BOX_SEED[1].y - 25 });
    // c was never selected, so it stays where it was (and the boxes below prove the
    // selection did not silently grow).
    expect(objectRect(c)).toEqual(BOX_SEED[2]);
  });

  it('a group move lifts the selected objects above the ones that are not selected', async () => {
    const [a, b, c] = await seedBoxes();
    expect([objectInDoc(a).z, objectInDoc(b).z, objectInDoc(c).z]).toEqual([1, 2, 3]);
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);

    await dragObject(a, { x: 20, y: 0 });

    // The unselected box used to be on top of both of them; now both selected boxes are
    // above it, and their order among themselves is what it was.
    const movedA = objectInDoc(a).z;
    const movedB = objectInDoc(b).z;
    expect(objectInDoc(c).z).toBe(3);
    expect(movedA).toBeGreaterThan(3);
    expect(movedB).toBeGreaterThan(movedA);
  });

  it('objects keep their size through a move', async () => {
    const [a] = await seedBoxes();
    await dragObject(a, { x: 80, y: 80 });
    const moved = objectRect(a);
    expect(moved.width).toBe(BOX_SEED[0].width);
    expect(moved.height).toBe(BOX_SEED[0].height);
  });
});

describe('resizing the selection (TC-24)', () => {
  it('TC-24: the box around a selection has 8 handles, each labelled with its position', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    expect(handleElements().length).toBe(8);
    expect(handleElement('nw').getAttribute('aria-label')).toBe('Resize top-left');
    expect(handleElement('n').getAttribute('aria-label')).toBe('Resize top');
    expect(handleElement('ne').getAttribute('aria-label')).toBe('Resize top-right');
    expect(handleElement('e').getAttribute('aria-label')).toBe('Resize right');
    expect(handleElement('se').getAttribute('aria-label')).toBe('Resize bottom-right');
    expect(handleElement('s').getAttribute('aria-label')).toBe('Resize bottom');
    expect(handleElement('sw').getAttribute('aria-label')).toBe('Resize bottom-left');
    expect(handleElement('w').getAttribute('aria-label')).toBe('Resize left');
    expect(selectionBoxWorld()).toEqual(BOX_SEED[0]);
  });

  it('TC-24: on a type that does not lock its proportions, the right handle changes width only', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    await dragHandle('e', { x: 50, y: 0 });

    const grown = objectRect(a);
    expect(grown.width).toBe(BOX_SEED[0].width + 50);
    expect(grown.height).toBe(BOX_SEED[0].height);
    // The left edge is the anchor: it does not move when the right handle is dragged.
    expect(grown.x).toBe(BOX_SEED[0].x);
    expect(grown.y).toBe(BOX_SEED[0].y);
  });

  it('TC-24: Shift holds the proportions of a type that would otherwise stretch freely', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    await dragHandle('se', { x: 100, y: 0 }, { shift: true });

    const grown = objectRect(a);
    expect(grown.width).toBe(BOX_SEED[0].width + 100);
    expect(grown.height).toBe(BOX_SEED[0].height + 100);
  });

  it('a corner handle without Shift follows the pointer on both axes', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    await dragHandle('se', { x: 100, y: 20 });

    const grown = objectRect(a);
    expect(grown.width).toBeCloseTo(BOX_SEED[0].width + 100, 6);
    expect(grown.height).toBeCloseTo(BOX_SEED[0].height + 20, 6);
  });

  it('a corner handle keeps a sticky note square', async () => {
    const id = createNote({ x: 100, y: 100 });
    await waitForNotes(1);
    await clickObject(id);
    await waitForSelected([id]);

    await dragHandle('se', { x: 100, y: 0 });

    const grown = objectRect(id);
    expect(grown.width).toBeCloseTo(200 + 100, 6);
    expect(grown.height).toBeCloseTo(200 + 100, 6);
  });

  it('shrinking stops at the type’s own minimum size', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    // 200 − 195 = 5, and a testbox stops at 10.
    await dragHandle('e', { x: -195, y: 0 });

    expect(objectRect(a).width).toBe(TESTBOX_MIN_SIZE);
    expect(objectRect(a).x).toBe(BOX_SEED[0].x);
  });

  it('a sticky note stops at STICKY_MIN_SIZE_WORLD and never below', async () => {
    const id = createNote({ x: 100, y: 100 });
    await waitForNotes(1);
    await clickObject(id);
    await waitForSelected([id]);

    await dragHandle('e', { x: -190, y: 0 });

    // The ratio holds, so a note whose width is squeezed to its minimum is a small square.
    expect(objectRect(id).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    expect(objectRect(id).height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
  });

  it('resizing the box of a group scales the gaps between the objects too', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);
    // The two boxes are 40 world units apart inside a 440-unit box.
    expect(selectionBoxWorld()).toEqual({ x: -580, y: -350, width: 440, height: 200 });

    await dragHandle('se', { x: 220, y: 0 });

    // One and a half times the box, which was only dragged across: the first object keeps
    // its corner, and the 40-unit gap between the two becomes 60.
    expectClose(objectRect(a), { x: -580, y: -350, width: 300, height: 200 });
    expectClose(objectRect(b), { x: -220, y: -350, width: 300, height: 200 });
  });
});

describe('a board that cannot be edited (TC-25)', () => {
  it('TC-25: while the board could not be loaded, a drag selects and writes nothing', async () => {
    const [a] = await seedBoxes();
    const before = objectRect(a);
    await socketsLive();
    await socketsCloseWith(CLOSE_BOARD_LOAD_FAILED);
    await vi.waitFor(() => {
      const status = document.querySelector<HTMLElement>('[data-testid="connection-status"]');
      if (status?.textContent !== LOAD_FAILED_LABEL) {
        throw new Error(`board does not say it could not be loaded: ${status?.textContent}`);
      }
    });

    // The press still selects: what it cannot do is change the document.
    await dragObject(a, { x: 60, y: 0 });

    expect(objectRect(a)).toEqual(before);
    await waitForSelected([a]);
  });
});

describe('the gesture’s beginning and end (TC-26)', () => {
  it('TC-26: the drag state turns on once and off once, and stays off after the release', async () => {
    const id = createNote({ x: 100, y: 100 });
    await waitForNotes(1);
    const element = noteElement(id);
    const from = noteCentreOnScreen(id);
    const start = objectRect(id);

    pointerDownOn(element, from);
    pointerMoveOn(element, { x: from.x + 40, y: from.y });
    await flushFrames();
    expect(noteElement(id).dataset.dragging).toBe('true');

    pointerMoveOn(element, { x: from.x + 60, y: from.y });
    pointerUpOn(element, { x: from.x + 60, y: from.y });
    await flushFrames();
    expect(noteElement(id).dataset.dragging).toBe('false');
    expect(objectRect(id).x).toBeCloseTo(start.x + 60, 6);

    // More pointer moves after the release change nothing: the gesture is over, and
    // `onGestureEnd` has been called exactly once (story 8 closes one undo step at it).
    pointerMoveOn(element, { x: from.x + 200, y: from.y });
    await flushFrames();
    expect(noteElement(id).dataset.dragging).toBe('false');
    expect(objectRect(id).x).toBeCloseTo(start.x + 60, 6);
  });

  it('TC-26: pointercancel mid-drag keeps the last applied position and ends the gesture', async () => {
    const id = createNote({ x: 100, y: 100 });
    await waitForNotes(1);
    const element = noteElement(id);
    const from = noteCentreOnScreen(id);
    const start = objectRect(id);

    pointerDownOn(element, from);
    pointerMoveOn(element, { x: from.x + 30, y: from.y });
    pointerMoveOn(element, { x: from.x + 40, y: from.y });
    await flushFrames();
    const last = objectRect(id).x;
    expect(last).toBeCloseTo(start.x + 40, 6);

    pointerCancelOn(element, { x: from.x + 40, y: from.y });
    await flushFrames();

    expect(noteElement(id).dataset.dragging).toBe('false');
    // Nothing rolls back: the board keeps where the last frame left the note (error path).
    expect(objectRect(id).x).toBe(last);

    pointerMoveOn(element, { x: from.x + 90, y: from.y });
    await flushFrames();
    expect(objectRect(id).x).toBe(last);
    // And the cancelled press is gone, so a new press on it starts a fresh gesture.
    pointerDownOn(element, { x: from.x + 90, y: from.y });
    pointerMoveOn(element, { x: from.x + 120, y: from.y });
    await flushFrames();
    pointerUpOn(element, { x: from.x + 120, y: from.y });
    await flushFrames();
    expect(objectRect(id).x).toBeCloseTo(start.x + 70, 6);
  });

  it('an object somebody else deletes mid-drag is skipped, and the rest keep moving', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);
    const origin = objectCentreOnScreen(a);

    // The press and the first move land while both boxes exist.
    pointerDownOn(objectElement(a), origin);
    pointerMoveOn(objectElement(a), { x: origin.x, y: origin.y + 20 });
    await flushFrames();
    expect(objectRect(a).y).toBe(BOX_SEED[0].y + 20);

    // Then the other browser deletes b, and the pointer keeps moving: the gesture does not
    // stop and does not throw, it just has one less object to write.
    await remoteDelete(b);
    pointerMoveOn(objectElement(a), { x: origin.x, y: origin.y + 50 });
    await flushFrames();
    pointerUpOn(objectElement(a), { x: origin.x, y: origin.y + 50 });
    await flushFrames();

    expect(objectRect(a)).toEqual({ ...BOX_SEED[0], y: BOX_SEED[0].y + 50 });
    expect(document.querySelector(`[data-note-id="${b}"]`)).toBeNull();
  });
});

describe('resizing something that keeps its shape', () => {
  it('stops an aspect-locked object at its minimum, on the side that runs out first', async () => {
    // A 4:3 picture. Pull its corner in as far as the board will allow and the short side is
    // the one that runs out of room first: the minimum is a promise about the box, not about
    // the axis a handle happened to be dragged along, so the one scale both axes are forced to
    // has to be the one that keeps the *short* side at 16.
    const id = seedImage({
      status: 'ready',
      size: { width: 640, height: 480 },
      at: { x: -320, y: -240 },
    });
    await flushFrames();
    await clickObject(id);
    await waitForSelected([id]);

    await dragHandle('se', { x: -3_000, y: -3_000 }, { steps: 6 });

    const box = objectRect(id);
    expect(Math.min(box.width, box.height)).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(box.width / box.height).toBeCloseTo(640 / 480, 4);
  });
});

/** Boxes and notes are compared as whole numbers; the maths behind them is not exact. */
function expectClose(actual: { x: number; y: number; width: number; height: number }, expected: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.width).toBeCloseTo(expected.width, 6);
  expect(actual.height).toBeCloseTo(expected.height, 6);
}
