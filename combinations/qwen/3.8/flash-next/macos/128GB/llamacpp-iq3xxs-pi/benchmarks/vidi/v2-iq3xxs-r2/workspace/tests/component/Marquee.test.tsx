// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  flushFrames,
  readCamera,
  renderBoard,
} from './fixtures/board';
import {
  BOX_SEED,
  clickObject,
  marqueeElement,
  marqueeWorld,
  plainPointerDown,
  plainPointerMove,
  plainPointerUp,
  objectRect,
  seedBoxes,
  selectionCountText,
  shiftDrag,
  shiftPointerCancel,
  shiftPointerDown,
  shiftPointerMove,
  shiftPointerUp,
  waitForSelected,
  EMPTY_SCREEN,
} from './fixtures/selection';

/**
 * Marquee selection (sel.marquee): Shift+drag draws a rectangle and everything *fully*
 * inside it joins the selection.
 *
 * The three seeded boxes sit at screen x 60–500, y 50–490 in an L, so one rectangle can
 * cover A completely while only touching B and C at the edge — the negative half of TC-32.
 */

// Screen coordinates of the rectangle that fully contains box A (60–260, 50–250) and
// touches, but does not contain, B and C.
const AROUND_A = { from: { x: 40, y: 30 }, to: { x: 300, y: 270 } };

beforeEach(async () => {
  await renderBoard();
  expect(readCamera().zoom).toBe(1);
});

describe('Shift+drag marquee (TC-20, TC-21, TC-22)', () => {
  it('TC-20: a marquee adds what is fully inside it to the current selection', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(c);
    await waitForSelected([c]);

    await shiftDrag(AROUND_A.from, AROUND_A.to);
    shiftPointerUp(AROUND_A.to);
    await flushFrames();

    // Additive: C is still selected, A joined it, and B — which the rectangle only touched
    // at its left edge — did not.
    await waitForSelected([a, c]);
    expect(selectionCountText()).toBe('2 selected');
    expect(marqueeElement()).toBeNull();
    expect(b).toBeDefined();
  });

  it('draws the rectangle in world units so a camera change mid-drag cannot change what it holds', async () => {
    await seedBoxes();

    shiftPointerDown(AROUND_A.from);
    shiftPointerMove({ x: 170, y: 150 });
    await flushFrames();

    const drawn = marqueeWorld();
    expect(drawn).not.toBeNull();
    expect(drawn?.width).toBeCloseTo(130, 6);
    expect(drawn?.height).toBeCloseTo(120, 6);
    // The rectangle is a drawing about the screen: it starts where the pointer went down.
    expect(marqueeElement()?.style.left).toBe('40px');
    expect(marqueeElement()?.style.top).toBe('30px');

    shiftPointerUp({ x: 170, y: 150 });
    await flushFrames();
    expect(marqueeElement()).toBeNull();
  });

  it('TC-21: a plain drag on empty space pans the board and draws no marquee', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);
    const before = readCamera();

    plainPointerDown(EMPTY_SCREEN);
    plainPointerMove({ x: EMPTY_SCREEN.x + 30, y: EMPTY_SCREEN.y + 20 });
    await flushFrames();
    expect(marqueeElement()).toBeNull();
    plainPointerMove({ x: EMPTY_SCREEN.x + 60, y: EMPTY_SCREEN.y + 40 });
    plainPointerUp({ x: EMPTY_SCREEN.x + 60, y: EMPTY_SCREEN.y + 40 });
    await flushFrames();

    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x - 60, 6);
    expect(after.y).toBeCloseTo(before.y - 40, 6);
    expect(marqueeElement()).toBeNull();
    // A pan is not a click, so the selection survives it.
    await waitForSelected([a]);
  });

  it('TC-22: pointercancel mid-marquee leaves the selection exactly as it was', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(b);
    await waitForSelected([b]);

    await shiftDrag(AROUND_A.from, AROUND_A.to);
    expect(marqueeElement()).not.toBeNull();
    shiftPointerCancel(AROUND_A.to);
    await flushFrames();

    expect(marqueeElement()).toBeNull();
    await waitForSelected([b]);
    expect(objectRect(a)).toEqual(BOX_SEED[0]);
  });

  it('Escape mid-marquee throws the rectangle away and keeps the selection', async () => {
    const [, b] = await seedBoxes();
    await clickObject(b);
    await waitForSelected([b]);

    await shiftDrag({ x: 40, y: 30 }, { x: 520, y: 500 });
    expect(marqueeElement()).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flushFrames();
    shiftPointerUp({ x: 520, y: 500 });
    await flushFrames();

    expect(marqueeElement()).toBeNull();
    // Both A and B were inside, and neither of them was selected.
    await waitForSelected([b]);
  });

  it('a marquee that catches nothing leaves the selection unchanged', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    await shiftDrag({ x: 900, y: 560 }, { x: 1000, y: 640 });
    shiftPointerUp({ x: 1000, y: 640 });
    await flushFrames();

    await waitForSelected([a]);
    expect(selectionCountText()).toBeNull();
  });
});

