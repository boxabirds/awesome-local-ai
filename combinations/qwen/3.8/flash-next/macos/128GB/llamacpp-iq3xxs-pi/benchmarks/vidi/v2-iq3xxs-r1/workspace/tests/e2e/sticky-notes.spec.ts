import { test, expect } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000 } from '../fixtures/texts';
import { gotoBoard, zoomLabel } from './helpers/board';
import {
  center,
  createByDoubleClick,
  createViaToolbar,
  dragTo,
  getCamera,
  noteAtPoint,
  noteBox,
  noteIds,
  panFar,
  selection,
  setZoom,
  snapshot,
  stopEditing,
  textInnerStyle,
  textareaValue,
} from './helpers/sticky';

const VIEWPORT = { width: 1280, height: 800 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.beforeEach(async ({ page }) => {
  await gotoBoard(page);
  await expect(zoomLabel(page)).toHaveText('100%');
});

test.describe('sticky notes (e2e)', () => {
  // TC-30: a real double-click on empty board space creates a note centred on
  // the pointer, and the characters typed go straight into it.
  test('TC-30 creates a note centred on the double-click point and types into it', async ({
    page,
  }) => {
    const point = { x: 400, y: 300 };
    const id = await createByDoubleClick(page, point);

    expect(await selection(page)).toEqual({ selectedId: id, editingId: id });
    await page.keyboard.type('Hello');

    const box = await noteBox(page, id);
    expect(Math.abs(box.x - point.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - point.y)).toBeLessThanOrEqual(1);
    expect(Math.round(box.width)).toBe(STICKY_SIZE_WORLD); // full size at 100%
    expect(Math.round(box.height)).toBe(STICKY_SIZE_WORLD);

    const all = await snapshot(page);
    expect(all).toHaveLength(1);
    expect(all[0]!.text).toBe('Hello');
    expect(all[0]!.color).toBe('yellow');
    expect(await textareaValue(page)).toBe('Hello');
  });

  // TC-31: at 50% the world moves by twice the pointer delta while the grabbed
  // point stays under the pointer, and the board itself never pans.
  test('TC-31 drags a note at 50% zoom: +200,+100 world for 100,50 screen px', async ({
    page,
  }) => {
    const id = await createViaToolbar(page);
    await stopEditing(page);
    await setZoom(page, 0.5);
    await expect(zoomLabel(page)).toHaveText('50%');

    const before = await snapshot(page);
    const cameraBefore = await getCamera(page);
    const boxBefore = await noteBox(page, id);
    expect(Math.round(boxBefore.width)).toBe(STICKY_SIZE_WORLD / 2);

    const delta = { x: 100, y: 50 };
    await dragTo(page, center(boxBefore), { x: boxBefore.x + delta.x, y: boxBefore.y + delta.y });

    const after = await snapshot(page);
    expect(after[0]!.x).toBeCloseTo(before[0]!.x + delta.x / 0.5, 1);
    expect(after[0]!.y).toBeCloseTo(before[0]!.y + delta.y / 0.5, 1);

    // the grabbed point (the note centre here) stayed under the pointer
    const boxAfter = await noteBox(page, id);
    expect(Math.abs(boxAfter.x - (boxBefore.x + delta.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - (boxBefore.y + delta.y))).toBeLessThanOrEqual(1);

    // dragging a note must not pan the board: identical camera, still 50%
    expect(await getCamera(page)).toEqual(cameraBefore);
    await expect(zoomLabel(page)).toHaveText('50%');
  });

  // TC-32: at 200% the world moves by half the pointer delta, and the dragged
  // note is drawn above the note it overlaps (bringToFront at drag start).
  test('TC-32 drags a note at 200% zoom: +50,+25 world and drawn above overlaps', async ({
    page,
  }) => {
    await setZoom(page, 2);
    await expect(zoomLabel(page)).toHaveText('200%');

    // Two overlapping notes; A is created first, so it is painted underneath.
    const a = await createByDoubleClick(page, { x: 500, y: 350 });
    await stopEditing(page);
    const b = await createByDoubleClick(page, { x: 850, y: 500 });
    await stopEditing(page);
    expect(await noteIds(page)).toEqual([a, b]);

    const boxA = await noteBox(page, a);
    // grab A where only A is present (B starts 350 px further right)
    const grab = { x: boxA.x - 150, y: boxA.y - 150 };
    expect(await noteAtPoint(page, grab)).toBe(a);

    const before = await snapshot(page);
    const delta = { x: 100, y: 50 };
    await dragTo(page, grab, { x: grab.x + delta.x, y: grab.y + delta.y });

    const after = await snapshot(page);
    const movedA = after.find((n) => n.id === a)!;
    const wasA = before.find((n) => n.id === a)!;
    expect(movedA.x).toBeCloseTo(wasA.x + delta.x / 2, 1);
    expect(movedA.y).toBeCloseTo(wasA.y + delta.y / 2, 1);

    // bringToFront ran once at drag start: A is now the topmost note
    expect(after[after.length - 1]!.id).toBe(a);
    const aNow = await noteBox(page, a);
    const bNow = await noteBox(page, b);
    const overlap = {
      x: Math.max(aNow.left, bNow.left) + 20,
      y: Math.max(aNow.top, bNow.top) + 20,
    };
    expect(overlap.x).toBeLessThan(Math.min(aNow.left + aNow.width, bNow.left + bNow.width));
    expect(await noteAtPoint(page, overlap)).toBe(a);
    // and it also moved under the pointer exactly
    const boxAAfter = await noteBox(page, a);
    expect(Math.abs(boxAAfter.x - (boxA.x + delta.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAAfter.y - (boxA.y + delta.y))).toBeLessThanOrEqual(1);
  });

  // TC-33: the font fit starts at the maximum size and shrinks the text down to
  // fit; at the limit the text is clipped, faded and never stored in full.
  test('TC-33 fits the font, then clips at the minimum size and clamps the text', async ({
    page,
  }) => {
    const id = await createViaToolbar(page);
    await page.keyboard.type('Runbook');

    const short = await textInnerStyle(page, id);
    expect(Math.round(parseFloat(short.fontSize))).toBe(STICKY_FONT_MAX_PX);
    expect(short.overflowClass).toBe(false);

    // paste 1,000 characters into a note that already holds a word
    await page.keyboard.insertText(PROSE_1000);

    const all = await snapshot(page);
    expect(all[0]!.text).toBe(`Runbook${PROSE_1000}`.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(all[0]!.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(await textareaValue(page)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    await expect(page.getByTestId('sticky-note-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );

    await stopEditing(page);
    const long = await textInnerStyle(page, id);
    const size = Math.round(parseFloat(long.fontSize));
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
    // clipped inside the note, with the bottom fade present
    expect(long.scrollHeight).toBeGreaterThan(long.containerClientHeight);
    expect(long.overflowClass).toBe(true);
    expect(long.fadePresent).toBe(true);
    // the note itself is still exactly a square of the world size on screen
    const box = await noteBox(page, id);
    expect(Math.round(box.width)).toBe(STICKY_SIZE_WORLD);
  });

  // TC-34: creating from the toolbar while panned far away always lands in view.
  test('TC-34 creates a note in the centre of the screen while panned far away', async ({
    page,
  }) => {
    const first = await createViaToolbar(page);
    await stopEditing(page);
    expect(Math.abs((await noteBox(page, first)).x - CENTER.x)).toBeLessThanOrEqual(1);

    await panFar(page, 900, 700); // travel away from the first note
    await panFar(page, 900, 700);
    expect(await snapshot(page)).toHaveLength(1);

    const id = await createViaToolbar(page);
    expect(await snapshot(page)).toHaveLength(2);

    const box = await noteBox(page, id);
    expect(Math.abs(box.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - CENTER.y)).toBeLessThanOrEqual(1);

    const all = await snapshot(page);
    expect(all[all.length - 1]!.id).toBe(id); // on top
    expect(all.find((n) => n.id === id)!.color).toBe('yellow');
    expect(await selection(page)).toEqual({ selectedId: id, editingId: id });
    await page.keyboard.type('Back in view');
    expect((await snapshot(page)).find((n) => n.id === id)!.text).toBe('Back in view');
  });

  // Workflow 1 - brainstorm golden path: create by double-click, type, move at
  // 50% zoom, recolour, delete.
  test('workflow 1: brainstorm, move at 50%, recolour, delete', async ({ page }) => {
    const a = await createByDoubleClick(page, { x: 380, y: 260 });
    await page.keyboard.type('Faster onboarding');
    await stopEditing(page);
    const b = await createByDoubleClick(page, { x: 760, y: 520 });
    await page.keyboard.type('Cut the sprint review');
    await stopEditing(page);

    let all = await snapshot(page);
    expect(all).toHaveLength(2);
    expect(Math.abs((await noteBox(page, a)).x - 380)).toBeLessThanOrEqual(1);
    const boxB = await noteBox(page, b);
    const beforeB = all.find((n) => n.id === b)!;
    expect(Math.abs(boxB.x - 760)).toBeLessThanOrEqual(1);

    // move note A at 50% zoom
    await setZoom(page, 0.5);
    const smallA = await noteBox(page, a);
    const beforeA = all.find((n) => n.id === a)!;
    await dragTo(page, center(smallA), { x: smallA.x + 120, y: smallA.y + 60 });
    all = await snapshot(page);
    expect(all.find((n) => n.id === a)!.x).toBeCloseTo(beforeA.x + 240, 1);
    expect(all.find((n) => n.id === a)!.y).toBeCloseTo(beforeA.y + 120, 1);
    const movedA = await noteBox(page, a);
    expect(Math.abs(movedA.x - (smallA.x + 120))).toBeLessThanOrEqual(1);

    // recolour note B through its pink swatch
    const bCentre = await noteBox(page, b);
    await page.mouse.click(bCentre.x, bCentre.y);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    await page.getByLabel('Pink colour').click();
    all = await snapshot(page);
    expect(all.find((n) => n.id === b)!.color).toBe('pink');
    expect(all.find((n) => n.id === b)!.text).toBe('Cut the sprint review');

    // delete note A with the keyboard
    const aCentre = await noteBox(page, a);
    await page.mouse.click(aCentre.x, aCentre.y);
    await page.keyboard.press('Delete');
    all = await snapshot(page);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(b);
    expect(all[0]!.color).toBe('pink');
    expect(all[0]!.text).toBe('Cut the sprint review');
    expect(await selection(page)).toEqual({ selectedId: null, editingId: null });

    // note B never moved, and the view can still be reset back to the origin
    const stillB = (await snapshot(page)).find((n) => n.id === b)!;
    expect(stillB.x).toBeCloseTo(beforeB.x, 6);
    expect(stillB.y).toBeCloseTo(beforeB.y, 6);
    await page.getByTestId('reset-view').click();
    await expect(zoomLabel(page)).toHaveText('100%');
    expect(await getCamera(page)).toEqual({ x: -CENTER.x, y: -CENTER.y, zoom: 1 });
    const finalBox = await noteBox(page, b);
    expect(Math.abs(finalBox.x - boxB.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(finalBox.y - boxB.y)).toBeLessThanOrEqual(1);
    expect(Math.round(finalBox.width)).toBe(STICKY_SIZE_WORLD);
  });

  // The toolbars live in screen space: they never scale with the board.
  test('toolbars keep a constant screen size while notes scale with zoom', async ({ page }) => {
    const id = await createViaToolbar(page);
    await stopEditing(page);
    const widthAt100 = await page
      .getByTestId('color-pink')
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    const noteWidthAt100 = (await noteBox(page, id)).width;

    await setZoom(page, 2);
    const widthAt200 = await page
      .getByTestId('color-pink')
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    const noteWidthAt200 = (await noteBox(page, id)).width;

    expect(Math.abs(widthAt200 - widthAt100)).toBeLessThanOrEqual(1); // toolbar unchanged
    expect(Math.round(noteWidthAt200)).toBe(Math.round(noteWidthAt100 * 2)); // note scales
  });
});
