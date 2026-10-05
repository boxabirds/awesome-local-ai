import { expect, test, type Page } from '@playwright/test';

import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import {
  clickNote,
  doubleClickCreate,
  dragNote,
  expectNoteWorld,
  note,
  noteIds,
  noteInteraction,
  noteScreenBox,
  noteWorld,
  openBoard,
  pressNoteAndMove,
  readCamera,
  setCamera,
  waitForNoteAtRest,
} from './helpers/board';

/** Where a note is grabbed: its centre, in screen pixels. */
function centre(page: Page, id: string) {
  return noteScreenBox(page, id);
}

test.describe('moving sticky notes', () => {
  // TC-31 at 50 % zoom, with the 1 pixel rule from the PRD
  test('at 50 % zoom a drag of (100, 50) screen pixels moves the note by (200, 100) world units', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { zoom: 0.5 });
    const camera = await readCamera(page);
    expect(camera.zoom).toBeCloseTo(0.5, 6);

    const id = await doubleClickCreate(page, 640, 400);
    await page.keyboard.press('Escape');
    const before = await noteWorld(page, id);
    const boxBefore = await centre(page, id);

    await pressNoteAndMove(page, id, 100, 50);
    // The note follows the pointer one screen pixel for one screen pixel, and the
    // position is written once per animation frame.
    const target = { x: before.x + 100 / 0.5, y: before.y + 50 / 0.5 };
    await expect
      .poll(() => noteWorld(page, id), { message: 'waiting for the note to follow the pointer' })
      .toMatchObject({ x: expect.closeTo(target.x, 0), y: expect.closeTo(target.y, 0) });
    const during = await noteScreenBox(page, id);
    expect(during.cx).toBeCloseTo(boxBefore.cx + 100, 0);
    expect(during.cy).toBeCloseTo(boxBefore.cy + 50, 0);
    await page.mouse.up();

    const after = await waitForNoteAtRest(page, id);
    expect(after.x).toBeCloseTo(before.x + 100 / 0.5, 0);
    expect(after.y).toBeCloseTo(before.y + 50 / 0.5, 0);

    // The grabbed point stays under the pointer: the note's screen box moved by
    // exactly the pointer delta, while the camera did not move at all.
    const boxAfter = await noteScreenBox(page, id);
    expect(boxAfter.cx).toBeCloseTo(boxBefore.cx + 100, 0);
    expect(boxAfter.cy).toBeCloseTo(boxBefore.cy + 50, 0);
    expect(await readCamera(page)).toEqual(camera);
    expect(await noteInteraction(page, id)).toBe('selected');
  });

  // TC-31 continued: recolour through a swatch, then delete with the keyboard
  test('at 50 % zoom a swatch recolours a note and Delete removes it', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { zoom: 0.5 });
    const kept = await doubleClickCreate(page, 300, 400);
    await page.keyboard.press('Escape');
    const doomed = await doubleClickCreate(page, 900, 400);
    await page.keyboard.press('Escape');

    await clickNote(page, doomed);
    await page.getByTestId('color-blue').click();
    expect(await note(page, doomed).getAttribute('data-color')).toBe('blue');
    expect(await note(page, kept).getAttribute('data-color')).not.toBe('blue');

    await page.keyboard.press('Delete');
    expect(await noteIds(page)).toEqual([kept]);
    await expect(note(page, doomed)).toHaveCount(0);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
  });

  // TC-32 at 200 % zoom, with stacking above an overlapped note
  test('at 200 % zoom a drag moves the note by half the pointer delta and stacks it on top', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { zoom: 2 });
    expect((await readCamera(page)).zoom).toBeCloseTo(2, 6);

    // Two notes that overlap: A to the upper-left, B to the lower-right.
    const a = await doubleClickCreate(page, 500, 300);
    await page.keyboard.press('Escape');
    const b = await doubleClickCreate(page, 760, 560);
    await page.keyboard.press('Escape');
    const boxA = await noteScreenBox(page, a);
    const boxB = await noteScreenBox(page, b);
    expect(boxA.x + boxA.width).toBeGreaterThan(boxB.x); // they really overlap
    expect((await noteWorld(page, a)).z).toBeLessThan((await noteWorld(page, b)).z);

    // Grab A where B is not: near A's own top-left corner.
    const before = await noteWorld(page, a);
    await page.mouse.move(boxA.x + 40, boxA.y + 40);
    await page.mouse.down();
    await page.mouse.move(boxA.x + 140, boxA.y + 90, { steps: 5 });
    await page.mouse.up();

    const after = await waitForNoteAtRest(page, a);
    expect(after.x).toBeCloseTo(before.x + 100 / 2, 0);
    expect(after.y).toBeCloseTo(before.y + 50 / 2, 0);
    // bringToFront ran when the drag started: A is drawn above B now.
    expect(after.z).toBeGreaterThan((await noteWorld(page, b)).z);
    expect(await noteIds(page)).toEqual([b, a]);
  });

  // The drag threshold, with a real mouse
  test('a two-pixel press selects the note and does not move it', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.press('Escape');
    const before = await noteWorld(page, id);
    const box = await noteScreenBox(page, id);
    expect(DRAG_THRESHOLD_PX).toBe(3);

    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx + 2, box.cy + 2);
    await page.waitForTimeout(60);
    expect(await noteInteraction(page, id)).not.toBe('dragging');
    await page.mouse.up();

    await waitForNoteAtRest(page, id);
    expect(await noteWorld(page, id)).toEqual(before);
    expect(await noteInteraction(page, id)).toBe('selected');
  });

  // pointercancel keeps the last shown position
  test('a drag that is cancelled keeps the position it was showing', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.press('Escape');
    const before = await noteWorld(page, id);
    const box = await noteScreenBox(page, id);

    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx + 60, box.cy + 40, { steps: 4 });
    await expect
      .poll(() => noteWorld(page, id), { message: 'waiting for the note to follow the pointer' })
      .toMatchObject({ x: expect.closeTo(before.x + 60, 0), y: expect.closeTo(before.y + 40, 0) });
    const shown = await noteWorld(page, id);

    // The browser cancels the gesture (touch cancel, alt-tab, system menu).
    await page.evaluate((params) => {
      document
        .querySelector(`[data-note-id="${params.id}"]`)
        ?.dispatchEvent(
          new PointerEvent('pointercancel', {
            bubbles: true,
            clientX: params.x,
            clientY: params.y,
            pointerId: params.pointerId,
          }),
        );
    }, { id, x: box.cx + 60, y: box.cy + 40, pointerId: 1 });
    await page.waitForTimeout(80);

    expect(await noteWorld(page, id)).toEqual(shown);
    expect(await noteInteraction(page, id)).toBe('selected');
  });

  // A note keeps the position the pointer left it at, far from the origin
  test('a note dragged a long way lands where the pointer left it', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 640, 400);
    await page.keyboard.press('Escape');
    const before = await noteWorld(page, id);

    // Up and to the left: the world position follows the pointer's direction.
    await dragNote(page, id, -400, -250);
    const middle = await waitForNoteAtRest(page, id);
    expect(middle.x).toBeCloseTo(before.x - 400, 0);
    expect(middle.y).toBeCloseTo(before.y - 250, 0);

    // Back down and to the right, ending near the edge of the window.
    await dragNote(page, id, 700, 500);
    const after = await waitForNoteAtRest(page, id);
    expect(after.x).toBeCloseTo(middle.x + 700, 0);
    expect(after.y).toBeCloseTo(middle.y + 500, 0);
    await expectNoteWorld(page, id, after);
    expect(await noteInteraction(page, id)).toBe('selected');
  });

  // The note on top takes the click; the one behind is left alone
  test('a drag of the top note does not move the note underneath', async ({ page }) => {
    await openBoard(page);
    const lower = await doubleClickCreate(page, 560, 400);
    await page.keyboard.press('Escape');
    const upper = await doubleClickCreate(page, 700, 400);
    await page.keyboard.press('Escape');
    const lowerBefore = await noteWorld(page, lower);

    // This point is covered by both notes; the upper one was created later.
    await page.mouse.click(660, 400);
    expect(await noteInteraction(page, upper)).toBe('selected');
    expect(await noteInteraction(page, lower)).toBe('unselected');

    await pressNoteAndMove(page, upper, 80, 40);
    await page.mouse.up();
    await waitForNoteAtRest(page, upper);
    expect(await noteWorld(page, lower)).toEqual(lowerBefore);
  });
});
