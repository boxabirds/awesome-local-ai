// Story 10, end to end: drawing shapes.
//
// TC-23 is the design's own drag, in screen pixels at 100% zoom: what comes out is
// the shape that was dragged, at the place it was dragged to. TC-24 is the other
// half of the tool - a click at 200% - and the label that has to stay centred while
// the shape it is wrapped into gets resized.
//
// Every browser the suite runs gets these; the design asks for the drag in all three.
// Assertions are about what the browser painted and what the shared document holds.
// The board opens with its start point in the middle of the window, so the board
// points a test can click are within roughly 640 by 400 of it, and the points used
// here are chosen inside that band.

import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../src/shared/config';
import { createBoard, expectPixels, openFreshBoard, setCamera } from './helpers/board';
import { openBoard } from './helpers/live';
import {
  clickShape,
  connectorToolLayer,
  drawShape,
  editShapeLabel,
  holdShapeTool,
  screenOf,
  selectShape,
  shapeAt,
  shapeLabel,
  shapeCount,
  shapeObjects,
  shapePreview,
  shapeScreenBox,
  shapeToolButton,
  shapeToolLayer,
  shapes,
  waitForShapesMatch,
} from './helpers/shapes';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The line boxes the label is painted in, as the browser laid them out. A label that
 * wraps is more than one box; a label that is centred has every box centred on the
 * shape's own centre line.
 */
async function labelBoxes(page: Page, index: number): Promise<Box[]> {
  return shapeLabel(page, index).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).map((r) => ({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    }));
  });
}

test.describe('draw a flow', () => {
  test('TC-23 a drag with the Shape tool draws the shape it was dragged as', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // the drag the design names: (100,100) to (300,220), in screen pixels
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };
    await holdShapeTool(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 4 });
    await expect(shapePreview(page)).toHaveCount(1); // the shape is previewed as it grows
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();

    // the shape is the drag: same box on the screen, to the pixel
    const box = await shapeScreenBox(page, 0);
    expectPixels(box.x, from.x);
    expectPixels(box.y, from.y);
    expectPixels(box.width, to.x - from.x);
    expectPixels(box.height, to.y - from.y);

    // and the board holds a shape of that size, in the default style, with no label
    const shape = await shapeAt(page, 0);
    expect(shape.kind).toBe('rect');
    expect(shape.width).toBeCloseTo(to.x - from.x, 0);
    expect(shape.height).toBeCloseTo(to.y - from.y, 0);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');

    // the preview went away with the drag, and the tool went with it: the pointer
    // belongs to Select again, and what is selected is the shape just drawn
    await expect(shapePreview(page)).toHaveCount(0);
    await expect(shapeToolLayer(page)).toHaveCount(0);
    await expect(shapeToolButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(shapeObjects(page).nth(0)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-23 a shape drawn in one browser is the same shape, in the same place, in another', async ({
    browser,
    request,
  }) => {
    const id = await createBoard(request);
    const dana = await openBoard(browser, id);
    const sam = await openBoard(browser, id);

    await drawShape(dana, { x: 200, y: 150 }, { x: 440, y: 290 }, { kind: 'ellipse' });
    await waitForShapesMatch([dana, sam]);

    const drawn = await shapes(dana);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.kind).toBe('ellipse');
    expect(drawn[0]?.width).toBeCloseTo(240, 0);
    expect(drawn[0]?.height).toBeCloseTo(140, 0);
    expect(await shapes(sam)).toEqual(drawn);

    // Sam sees it painted where the document says it is
    const box = await shapeScreenBox(sam, 0);
    const where = await screenOf(sam, { x: drawn[0]!.x, y: drawn[0]!.y });
    expectPixels(box.x, where.x);
    expectPixels(box.y, where.y);
    expectPixels(box.width, 240);
    expectPixels(box.height, 140);
  });

  test('TC-24 a click makes the standard shape, centred on the click, at 200%', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });

    const click = { x: 320, y: 200 }; // a board point, in the middle of the window at 200% zoom
    const onScreen = await screenOf(page, click);
    await clickShape(page, click, 'diamond');

    // the standard size and centred on the click: at 200% a 160-world shape is 320 px
    const box = await shapeScreenBox(page, 0);
    expectPixels(box.width, SHAPE_DEFAULT_SIZE_WORLD * 2);
    expectPixels(box.height, SHAPE_DEFAULT_SIZE_WORLD * 2);
    expectPixels(centreOf(box).x, onScreen.x);
    expectPixels(centreOf(box).y, onScreen.y);

    const shape = await shapeAt(page, 0);
    expect(shape.kind).toBe('diamond');
    expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
  });

  test('TC-24 a label longer than the shape wraps, and stays centred when the shape is resized', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });

    await clickShape(page, { x: 320, y: 200 }, 'rect');

    // the label is typed into the shape, with the same editor a note's words use
    const text = 'wrapped inside the shape because it is longer than the shape is wide';
    await editShapeLabel(page, 0);
    await page.keyboard.type(text);
    await expect(shapeLabel(page, 0)).toHaveCount(0); // being typed, not yet painted
    await page.keyboard.press('Escape');
    await expect(shapeLabel(page, 0)).toHaveText(text);
    expect(text.length).toBeLessThan(SHAPE_LABEL_MAX_CHARS);

    // it wraps into more than one line, and every line is centred on the shape
    const before = await shapeScreenBox(page, 0);
    let lines = await labelBoxes(page, 0);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expectPixels(centreOf(line).x, centreOf(before).x);
    expectPixels((lines[0]!.y + lines[lines.length - 1]!.y + lines[lines.length - 1]!.height) / 2, centreOf(before).y, 2);

    // resize it by the handle: the edge moves, the opposite edge stays, and the label
    // re-wraps into the new width still centred in the middle of it
    const handle = page.getByTestId('resize-handle-e');
    const edge = await handle.boundingBox();
    await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge!.x + edge!.width / 2 + 60, edge!.y + edge!.height / 2, { steps: 6 });
    await page.mouse.up();

    const after = await shapeScreenBox(page, 0);
    expectPixels(after.x, before.x); // the far edge did not move
    expectPixels(after.width, before.width + 60);
    lines = await labelBoxes(page, 0);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expectPixels(centreOf(line).x, centreOf(after).x);
    expectPixels((lines[0]!.y + lines[lines.length - 1]!.y + lines[lines.length - 1]!.height) / 2, centreOf(after).y, 2);

    // nothing about the label changed but where it happens to break
    expect(await shapeAt(page, 0)).toMatchObject({ label: text });
  });

  test('TC-24 a label is the shape\u2019s own text, so a colleague resizing the shape keeps it', async ({
    browser,
    request,
  }) => {
    const id = await createBoard(request);
    const dana = await openBoard(browser, id);
    const sam = await openBoard(browser, id);

    await drawShape(dana, { x: 200, y: 100 }, { x: 400, y: 260 });
    await waitForShapesMatch([dana, sam]);
    await editShapeLabel(dana, 0);
    const text = 'a label with words in it that goes on for a little while';
    await dana.keyboard.type(text);
    await dana.keyboard.press('Escape');
    await waitForShapesMatch([dana, sam]);

    // Sam resizes the same shape; the label is the shape's, so it survives untouched
    await selectShape(sam, 0);
    const handle = sam.getByTestId('resize-handle-e');
    const edge = await handle.boundingBox();
    await sam.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2);
    await sam.mouse.down();
    await sam.mouse.move(edge!.x + edge!.width / 2 + 70, edge!.y + edge!.height / 2, { steps: 5 });
    await sam.mouse.up();
    await waitForShapesMatch([dana, sam]);

    const both = await shapes(dana);
    expect(both[0]?.width).toBeCloseTo(270, 0);
    expect(both[0]?.label).toBe(text);
    expect(await shapes(sam)).toEqual(both);
    expect(await shapeCount(dana)).toBe(1);
    await expect(shapeLabel(dana, 0)).toHaveText(text);
    await expect(connectorToolLayer(dana)).toHaveCount(0);
  });
});
