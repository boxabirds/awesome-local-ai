import { expect, test } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import {
  expectClose,
  gotoBoard,
  readCamera,
  setCamera,
  dragPointer,
  settle,
} from './helpers/board';
import {
  clickConnectorTool,
  clickShapeKind,
  clickShapeSwatch,
  clickShapeTool,
  connectorsOn,
  createShapeOnBoard,
  editShapeLabel,
  endShapeEdit,
  selectedShapeIds,
  shapeCentre,
  shapeKindPressed,
  shapeLabelMetrics,
  shapeScreenRect,
  shapesOn,
  toolPressed,
  typeShapeLabel,
  waitForConnectors,
  waitForShapes,
} from './helpers/shapes';

/**
 * Story 10 in a real browser: shapes drawn by dragging, and shapes drawn by clicking (TC-23,
 * TC-24).
 *
 * Both are measured on the screen as well as in the document, because the claim being tested is
 * about where a shape is: a box 200 board units wide drawn at 200% zoom has to be 400 CSS
 * pixels wide, centred under the pointer that made it. Everything here runs in Chromium, Firefox
 * and WebKit alike — the Playwright projects give every test in this file to every browser that
 * can be launched (TC-23 in all three).
 */

const OPEN = { x: 300, y: 220 };

/** Longer than a 160-unit shape can hold on one line: the PRD's "label longer than the shape". */
const LONG_LABEL = [
  'the discovery board sat in the middle of the room for three weeks, and every morning somebody ',
  'added one more card to the cluster about onboarding before they remembered the card they had ',
  'already put there the week before, which is how we finally learned that the copy nobody could ',
  'find was written twice and stored in two places, neither of them the design file',
].join('');

test('TC-23: a dragged shape is 200x120 board units, exactly where it was dragged', async ({
  page,
}) => {
  await gotoBoard(page);
  const camera = await readCamera(page);
  expect(camera.zoom).toBe(1);

  await clickShapeTool(page);
  await dragPointer(page, { x: 100, y: 100 }, { x: 300, y: 220 });

  const shapes = await waitForShapes(page, 1);
  const shape = shapes[0];
  expect(shape.type).toBe('shape');
  expect(shape.kind).toBe('rect');
  // The board's own numbers: 200 by 120 units, at the board point the drag started at.
  expectClose(shape.width, 200);
  expectClose(shape.height, 120);
  expectClose(shape.x, 100 - 640);
  expectClose(shape.y, 100 - 400);

  // And the same box on the screen, to the pixel: at 100% zoom they are the same numbers.
  const rect = await shapeScreenRect(page, shape.id);
  expectClose(rect.x, 100);
  expectClose(rect.y, 100);
  expectClose(rect.width, 200);
  expectClose(rect.height, 120);

  // The new shape is the selection, and Select is the tool in hand again (PRD steps 2 and 4).
  expect(await selectedShapeIds(page)).toEqual([shape.id]);
  expect(await toolPressed(page, 'tool-shape')).toBe(false);
  expect(await toolPressed(page, 'tool-select')).toBe(true);
});

test('a flow of two shapes and an arrow follows a move of either', async ({ page }) => {
  await gotoBoard(page);
  const first = await createShapeOnBoard(page, { x: 320, y: 220 }, { x: 480, y: 340 });
  const second = await createShapeOnBoard(page, { x: 700, y: 300 }, { x: 860, y: 420 });
  expect(await waitForShapes(page, 2)).toHaveLength(2);

  await clickConnectorTool(page);
  await dragPointer(page, await shapeCentre(page, first), await shapeCentre(page, second));
  const arrows = await waitForConnectors(page, 1);
  const arrow = arrows[0];
  expect(arrow.from.kind).toBe('attached');
  expect(arrow.to.kind).toBe('attached');
  const before = arrow.ends.from.x;

  // Move the shape the arrow starts from, and nothing else is written: the arrow follows.
  const from = await shapeCentre(page, first);
  await dragPointer(page, from, { x: from.x, y: from.y - 120 });
  await settle(page);

  const after = (await connectorsOn(page))[0];
  expect(after.from.kind).toBe('attached');
  expect(after.from.objectId).toBe(first);
  // The end moved with the shape, and the end on the shape nobody touched did not move.
  expect(after.ends.from.x).toBeCloseTo(before, 6);
  expect(after.ends.from.y).toBeCloseTo(arrow.ends.from.y - 120, 1);
  expect(after.ends.to.x).toBeCloseTo(arrow.ends.to.x, 6);
  expect(after.ends.to.y).toBeCloseTo(arrow.ends.to.y, 6);
});

test('TC-24: a diamond clicked at 200% zoom is 160 units square, centred on the click', async ({
  page,
}) => {
  await gotoBoard(page);
  // Exactly 200%, through the test hook the camera exposes: the step buttons land on 1.95 and
  // 2.44, and a test that wants a 2:1 screen-to-board ratio should be allowed to have one.
  await setCamera(page, { x: -640, y: -400, zoom: 2 });

  await clickShapeTool(page);
  await clickShapeKind(page, 'diamond');
  expect(await shapeKindPressed(page, 'diamond')).toBe(true);

  const clicked = { x: 700, y: 340 };
  await page.mouse.click(clicked.x, clicked.y);
  await settle(page);

  const shapes = await waitForShapes(page, 1);
  const shape = shapes[0];
  expect(shape.kind).toBe('diamond');
  // The standard size the settings name, whatever the zoom says on the screen.
  expectClose(shape.width, SHAPE_DEFAULT_SIZE_WORLD, 0.5);
  expectClose(shape.height, SHAPE_DEFAULT_SIZE_WORLD, 0.5);

  const rect = await shapeScreenRect(page, shape.id);
  expectClose(rect.width, SHAPE_DEFAULT_SIZE_WORLD * 2, 1);
  expectClose(rect.height, SHAPE_DEFAULT_SIZE_WORLD * 2, 1);
  expectClose(rect.centerX, clicked.x, 1);
  expectClose(rect.centerY, clicked.y, 1);
});

test('TC-24: a label longer than the shape wraps, stays centred, and re-wraps when the shape is resized', async ({
  page,
}) => {
  await gotoBoard(page);
  const id = await createShapeOnBoard(page, OPEN);
  const shape = (await shapesOn(page)).find((entry) => entry.id === id);
  if (!shape) throw new Error(`no shape with id ${id}`);
  expectClose(shape.width, SHAPE_DEFAULT_SIZE_WORLD, 0.5);

  // Type into the label the way a person does: double-click, then keyboard.
  await editShapeLabel(page, id);
  await typeShapeLabel(page, LONG_LABEL);
  expect(LONG_LABEL.length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
  await endShapeEdit(page);

  const wrapped = await shapeLabelMetrics(page, id);
  expect(wrapped.text.replace(/\s+/g, ' ')).toBe(LONG_LABEL.replace(/\s+/g, ' '));
  expect(wrapped.lines).toBeGreaterThan(3);
  // Centred, both ways, in the shape that holds it.
  expectClose(wrapped.labelCentreX, wrapped.shapeCentreX, 1);
  expectClose(wrapped.labelCentreY, wrapped.shapeCentreY, 1);

  // Make the shape wider by dragging its right handle: the label re-wraps in the box it is in.
  const before = await shapeScreenRect(page, id);
  await page.mouse.click(Math.round(before.centerX), Math.round(before.centerY));
  const handle = await page.locator('[data-handle="e"]').boundingBox();
  if (!handle) throw new Error('a selected shape has no right handle');
  await dragPointer(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: handle.x + handle.width / 2 + 180, y: handle.y + handle.height / 2 },
  );
  await settle(page);

  const grown = await shapeScreenRect(page, id);
  expectClose(grown.width, before.width + 180, 2);
  const rewrapped = await shapeLabelMetrics(page, id);
  expect(rewrapped.lines).toBeLessThan(wrapped.lines);
  expect(rewrapped.text.replace(/\s+/g, ' ')).toBe(LONG_LABEL.replace(/\s+/g, ' '));
  expectClose(rewrapped.labelCentreX, rewrapped.shapeCentreX, 1);
  expectClose(rewrapped.labelCentreY, rewrapped.shapeCentreY, 1);
});

test('a shape keeps its label and its box while its colours change, and S is the Shape shortcut', async ({
  page,
}) => {
  await gotoBoard(page);
  // The keyboard shortcut the PRD names, pressed on its own.
  await page.keyboard.press('s');
  await expect.poll(() => toolPressed(page, 'tool-shape')).toBe(true);
  const id = await createShapeOnBoard(page, { x: 420, y: 240 }, { x: 620, y: 400 });
  await editShapeLabel(page, id);
  await typeShapeLabel(page, 'discovery');
  await endShapeEdit(page);
  const before = await shapesOn(page);
  const shaped = before.find((entry) => entry.id === id);
  if (!shaped) throw new Error(`no shape with id ${id}`);

  // Select it alone, then a fill and an outline.
  await page.mouse.click(520, 320);
  await settle(page);
  expect(await selectedShapeIds(page)).toEqual([id]);
  await clickShapeSwatch(page, 'Blue fill');
  await clickShapeSwatch(page, 'Red outline');
  await settle(page);

  const changed = (await shapesOn(page)).find((entry) => entry.id === id);
  expect(changed?.fill).toBe('blue');
  expect(changed?.stroke).toBe('red');
  // Nothing else about it moved (PRD: colour without changing label, size, position or selection).
  expect(changed?.label).toBe(shaped.label);
  expect(changed?.x).toBe(shaped.x);
  expect(changed?.y).toBe(shaped.y);
  expect(changed?.width).toBe(shaped.width);
  expect(changed?.height).toBe(shaped.height);
  expect(await selectedShapeIds(page)).toEqual([id]);
});
