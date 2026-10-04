/**
 * Story 10 end to end: drawing shapes with a real mouse in a real browser.
 *
 * The camera is put at `{x: 0, y: 0, zoom: 1}` for every case, so one board unit is one
 * screen pixel from the board's top-left: the rectangle a test describes by two points
 * is the rectangle the person sees, and what is checked afterwards is the board's own
 * state read out of the shared document, next to the box this browser drew. A case where
 * those two disagree is exactly the bug this story could ship with — a shape whose stored
 * box and drawn box come from different rules.
 *
 * TC-23 a drag draws the shape it previewed · TC-24 a click drops the standard size, a
 * long label wraps inside the shape and stays centred when the shape is resized.
 */

import { expect, test } from './helpers/live';
import { openBoard, setCamera } from './helpers/board';
import {
  createShapeByClick,
  createShapeByDrag,
  getShapes,
  labelInfo,
  pickSelectTool,
  selectShape,
  shapeBoxes,
} from './helpers/drawing';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';

/** One board unit to one screen pixel, from the board's top-left corner. */
const FLAT = { x: 0, y: 0, zoom: 1 };

test.describe('shapes', () => {
  test.beforeEach(async ({ page }) => {
    // openBoard waits for the board to be on screen, which is also when the test hooks
    // the geometry assertions read are installed.
    await openBoard(page);
    await setCamera(page, FLAT);
  });

  test('TC-23: a drag draws the shape it previewed, at that size and place', async ({
    page,
  }) => {
    const id = await createShapeByDrag(page, { x: 100, y: 100 }, { x: 300, y: 220 });

    // The document's box: what everybody else will draw.
    const shape = (await getShapes(page)).find((entry) => entry.id === id);
    expect(shape).toMatchObject({ kind: 'rect', x: 100, y: 100, width: 200, height: 120 });

    // This browser's box, within a pixel of it.
    const drawn = (await shapeBoxes(page))[id]!;
    expect(Math.abs(drawn.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.height - 120)).toBeLessThanOrEqual(1);

    // The tool put itself down, and the new shape is the selection: its toolbar is up.
    await expect(page.getByTestId('shape-tool-layer')).toHaveCount(0);
    await expect(page.getByTestId('shape-toolbar')).toBeVisible();
  });

  test('TC-23b: Shift squares it, and a drag upward draws the same box', async ({ page }) => {
    const square = await createShapeByDrag(
      page,
      { x: 400, y: 200 },
      { x: 600, y: 320 },
      { shift: true },
    );
    const shape = (await getShapes(page)).find((entry) => entry.id === square);
    expect(shape).toMatchObject({ x: 400, y: 200, width: 200, height: 200 });

    // The other three corners work: dragging from bottom-right to top-left draws the
    // same rectangle, not a negative one.
    const back = await createShapeByDrag(page, { x: 1000, y: 600 }, { x: 800, y: 440 });
    const other = (await getShapes(page)).find((entry) => entry.id === back);
    expect(other).toMatchObject({ x: 800, y: 440, width: 200, height: 160 });
  });

  test('TC-24: a click drops the standard size, centred under the pointer', async ({
    page,
  }) => {
    const id = await createShapeByClick(page, { x: 640, y: 400 }, 'diamond');
    const shape = (await getShapes(page)).find((entry) => entry.id === id);
    const size = SHAPE_DEFAULT_SIZE_WORLD;
    expect(shape).toMatchObject({
      kind: 'diamond',
      width: size,
      height: size,
      x: 640 - size / 2,
      y: 400 - size / 2,
    });

    // And it is drawn as a diamond: the outline element is a polygon, not a rect.
    await expect(
      page.locator(`[data-object-id="${id}"] svg polygon`),
    ).toHaveCount(1);
  });

  test('TC-24b: a long label wraps inside the shape and stays centred through a resize', async ({
    page,
  }) => {
    const id = await createShapeByClick(page, { x: 640, y: 300 }, 'rect');

    // Type into it: double-click opens the label where the words already are.
    await page.mouse.dblclick(640, 300);
    const editor = page.locator(`[data-object-id="${id}"] textarea`);
    await expect(editor).toBeVisible();
    const words =
      'a label long enough that it cannot possibly fit on one line inside a shape of this size';
    await page.keyboard.type(words);
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);

    const before = await labelInfo(page, id);
    expect(before.text).toBe(words);
    expect(before.lines).toBeGreaterThan(1);
    const box = (await shapeBoxes(page))[id]!;
    expect(Math.abs(before.centre.x - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(before.centre.y - (box.y + box.height / 2))).toBeLessThanOrEqual(1);

    // Make the shape wider by dragging its corner: the label re-wraps, and is still
    // centred in the box the document now holds.
    await selectShape(page, id);
    const handle = page.locator('[data-resize-handle="se"]');
    const at = await handle.boundingBox();
    if (!at) throw new Error('the resize handle has no box');
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 + 180, at.y + at.height / 2, { steps: 6 });
    await page.mouse.up();
    await pickSelectTool(page);

    const grown = (await shapeBoxes(page))[id]!;
    expect(grown.width).toBeGreaterThan(box.width + 100);
    const after = await labelInfo(page, id);
    expect(after.text).toBe(words);
    expect(Math.abs(after.centre.x - (grown.x + grown.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.centre.y - (grown.y + grown.height / 2))).toBeLessThanOrEqual(1);
  });

  test('TC-24c: the fill and outline palettes colour the shape and nothing else', async ({
    page,
  }) => {
    const id = await createShapeByClick(page, { x: 640, y: 400 }, 'ellipse');
    const before = (await getShapes(page)).find((entry) => entry.id === id)!;
    await selectShape(page, id);
    await page.getByRole('button', { name: 'pink fill' }).click();
    await page.getByRole('button', { name: 'red outline' }).click();

    const after = (await getShapes(page)).find((entry) => entry.id === id)!;
    expect(after).toMatchObject({ fill: 'pink', stroke: 'red' });
    // Its geometry is untouched: the toolbar changed colours, not the shape.
    expect(after).toMatchObject({ x: before.x, y: before.y, width: before.width, height: before.height });

    // And the drawing follows: the ellipse on screen has the pink as its fill.
    const fill = await page
      .locator(`[data-object-id="${id}"] ellipse`)
      .first()
      .evaluate((el) => el.getAttribute('fill'));
    expect((fill ?? '').toUpperCase()).toBe('#F8BBD0');
  });
});
