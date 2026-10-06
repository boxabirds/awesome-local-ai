/**
 * Component tests for the rubber band (design capability `sel.marquee_ui`, TC-20 to TC-22): the one
 * drag on the board that adds to a selection instead of replacing it.
 *
 * The rectangle is local, the selection is local, and nothing is written to the document while it is
 * being pulled — so the whole of what can go wrong here is visible from the rendered board: where the
 * rectangle is, whether it is still on screen, and which ids the selection holds when the pointer
 * comes up.
 *
 * Coordinates: the test viewport is 1280×800 and the camera starts at (−640, −400) at zoom 1, so a
 * world point is drawn 640 across and 400 down from itself. `fx.screen()` does that arithmetic from
 * the camera the board is actually drawing, and a note created at a world point is centred on it.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Point } from '../../src/shared/geometry';
import {
  act,
  nextFrame,
  pointer,
  renderedCamera,
  renderBoard,
  type BoardFixture,
} from './harness';

const surface = (): HTMLElement => screen.getByTestId('board-viewport');

/** The rectangle the marquee is drawing, in world units, or null when it is not drawing one. */
function rectOf(fx: BoardFixture): { x: number; y: number; width: number; height: number } | null {
  return fx.marqueeRect();
}

/**
 * Pulls a marquee from one world point to another, in screen coordinates, optionally letting go of
 * Shift on the way up. The middle step is what makes it a drag rather than a click.
 */
async function dragBoard(
  fx: BoardFixture,
  from: Point,
  to: Point,
  options: { shift?: boolean; end?: 'up' | 'cancel' | 'escape' } = {},
): Promise<void> {
  const { shift = true, end = 'up' } = options;
  const pointerId = 7;
  pointer('pointerDown', surface(), { ...fx.screen(from), shiftKey: shift, pointerId });
  await act(nextFrame);
  pointer('pointerMove', surface(), { ...fx.screen(to), shiftKey: shift, pointerId });
  await act(nextFrame);

  if (end === 'escape') {
    // Escape goes to the window, which is where the marquee is listening for it.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextFrame();
    });
    return;
  }
  const type = end === 'cancel' ? 'pointerCancel' : 'pointerUp';
  pointer(type, surface(), { ...fx.screen(to), shiftKey: shift, pointerId });
  await act(nextFrame);
}

describe('selecting by dragging a rectangle', () => {
  it('TC-20 adds what is wholly inside the rectangle to what was already selected', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0); // world box (−100,−100)→(100,100)
    const b = await fx.create(300, 0); // (200,−100)→(400,100)
    const c = await fx.create(600, 0); // (500,−100)→(700,100)
    await fx.press(a);
    expect(fx.selection().selectedId).toBe(a);

    // World (−200,−200)→(560,200): a and b are inside it, and the rectangle cuts through c.
    await dragBoard(fx, { x: -200, y: -200 }, { x: 560, y: 200 });

    expect([...fx.selection().ids].sort()).toEqual([a, b].sort());
    // c was cut through, and an object the rectangle only touches is not a selected object.
    expect(fx.selection().ids.has(c)).toBe(false);
    expect(fx.noteBox(c).selected).toBe(false);
    // The rectangle is a means, not a mode: it does not survive the gesture that made it.
    expect(fx.marqueeEl()).toBeNull();
    expect(fx.barText()).toBe('2 selected');
  });

  it('TC-20 draws the rectangle in world units while it is being pulled, and writes nothing', async () => {
    const fx = renderBoard();
    await fx.create(0, 0);
    const before = fx.doc().toJSON();

    pointer('pointerDown', surface(), { ...fx.screen({ x: -200, y: -200 }), shiftKey: true, pointerId: 7 });
    await act(nextFrame);
    pointer('pointerMove', surface(), { ...fx.screen({ x: 560, y: 200 }), shiftKey: true, pointerId: 7 });
    await act(nextFrame);

    expect(rectOf(fx)).toEqual({ x: -200, y: -200, width: 760, height: 400 });
    // The rectangle has to be painted where the pointer is, which is a screen place: world (−200,−200)
    // is drawn at screen (440,200) by this camera.
    const style = fx.marqueeEl()?.getAttribute('style') ?? '';
    expect(style).toContain('left: 440px');
    expect(style).toContain('top: 200px');
    // A pull is not an edit: not one byte of the document has moved.
    expect(fx.doc().toJSON()).toEqual(before);
    expect(fx.selection().size).toBe(0);
  });

  it('TC-20 pulls a rectangle over empty board and leaves the selection exactly as it was', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);

    // A rectangle over nothing, added to a selection of one, is still a selection of one.
    await dragBoard(fx, { x: 2000, y: 2000 }, { x: 2400, y: 2400 });

    expect(fx.selection().ids.has(a)).toBe(true);
    expect(fx.selection().size).toBe(1);
  });

  it('TC-20 leaves an object the rectangle only touches to the side, unselected', async () => {
    const fx = renderBoard();
    const inside = await fx.create(0, 0); // (−100,−100)→(100,100)
    const straddling = await fx.create(400, 0); // (300,−100)→(500,100): its left half is in, its right half is not

    await dragBoard(fx, { x: -200, y: -200 }, { x: 400, y: 200 });

    expect(fx.selection().ids.has(inside)).toBe(true);
    expect(fx.selection().ids.has(straddling)).toBe(false);
  });

  it('TC-21 gives a drag without Shift to the camera, and never draws a rectangle', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);
    const camera = renderedCamera();

    // The same gesture, one key absent: the board moves, the notes stay where they are.
    await dragBoard(fx, { x: -200, y: -200 }, { x: 560, y: 200 }, { shift: false });

    expect(renderedCamera().x).toBe(camera.x - 760);
    expect(renderedCamera().y).toBe(camera.y - 400);
    expect(fx.marqueeEl()).toBeNull();
    expect(fx.boundsOf(a)).toEqual({ x: -100, y: -100, width: 200, height: 200, z: 1 });
  });

  it('TC-22 lets go of the rectangle when the system takes the pointer, and selects nothing', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);
    const before = fx.selection();

    // A pointer a browser takes back — a touch gesture, a menu, a window switch — in the middle of a
    // rectangle is a rectangle somebody abandoned, not one they finished.
    await dragBoard(fx, { x: -200, y: -200 }, { x: 560, y: 200 }, { end: 'cancel' });

    expect([...fx.selection().ids].sort()).toEqual([...before.ids].sort());
    expect(fx.selection().ids.has(a)).toBe(true);
    expect(fx.selection().size).toBe(1);
    expect(fx.marqueeEl()).toBeNull();
  });

  it('TC-22 gives Escape to the rectangle while one is being pulled', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);

    // Escape ends the rectangle before the board sees the key: one press of it does not both drop the
    // rectangle and empty the selection, which is the way a person loses a selection by accident.
    await dragBoard(fx, { x: -200, y: -200 }, { x: 560, y: 200 }, { end: 'escape' });

    expect(fx.marqueeEl()).toBeNull();
    expect(fx.selection().size).toBe(1);
    expect(fx.selection().ids.has(a)).toBe(true);
  });

  it('TC-22 still pans the board when a plain drag is cancelled halfway', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const camera = renderedCamera();

    // Story 1's panning is unchanged by the rectangle's existence — including its pointercancel.
    await dragBoard(fx, { x: -200, y: -200 }, { x: 560, y: 200 }, { shift: false, end: 'cancel' });

    expect(renderedCamera().x).toBe(camera.x - 760);
    expect(fx.selection().size).toBe(0);
    expect(fx.boundsOf(a)).toEqual({ x: -100, y: -100, width: 200, height: 200, z: 1 });
  });
});
