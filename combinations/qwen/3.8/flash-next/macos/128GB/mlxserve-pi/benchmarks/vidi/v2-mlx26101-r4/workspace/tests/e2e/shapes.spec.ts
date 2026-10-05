/**
 * e2e tests for drawing shapes with the Shape tool (story 10, TC-23 and TC-24).
 *
 * These are the two cases a jsdom test cannot settle, because both are about where a shape ends up
 * *on a screen*: that the box a person drags is the box that gets made, to within a pixel of where the
 * mouse travelled, and that a shape's words really wrap inside a shape that is being looked at from
 * 200% and resized with a handle that is drawn at a size a hand can hit.
 *
 * The camera is set by every test and read back before it is used, so board units and screen pixels
 * are converted rather than assumed — the same discipline the board's own gestures keep. Anything
 * read out of the page's document is in board units and needs no conversion; anything measured off
 * the painted page is in pixels and is compared against what this page's camera says those board units
 * should be, to within `TOLERANCE_PX`.
 *
 * Nothing here asserts an arrow's endpoints: a shape is an object with a box and words, and the
 * question of which side an arrow joins it on belongs to `connectors.spec.ts`.
 */
import { expect, test } from '@playwright/test';

import { DEFAULT_TEXT_SIZE, SHAPE_DEFAULT_SIZE_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { expectPixels, openBoard, settled, setCamera, worldToScreen } from './helpers/board';
import type { Point } from './helpers/board';
import {
  PLAIN,
  armShapeTool,
  clickShape,
  drawShape,
  expectedPainted,
  putToolDown,
  resizeSelected,
  shapeKindMenu,
  shapePainted,
  shapeOnPage,
  shapesOnPage,
  toolOf,
  typeShapeLabel,
  wordsLayout,
} from './helpers/shapes';

/** The box a person drags for TC-23, in board units. */
const DRAG_FROM: Point = { x: 100, y: 100 };
const DRAG_TO: Point = { x: 300, y: 220 };

/** Where a click makes a diamond for TC-24, in board units, at 200%. */
const CLICK_AT: Point = { x: 400, y: 300 };

/** A label with more words in it than a shape of that width has room for. */
const A_LONG_NAME =
  'Discovery: the four people who were shown the prototype all tried to drag the arrow before they tried to drag the box it pointed at';

/**
 * How far the middle of a label's letters may sit from the middle of its shape, in screen pixels.
 *
 * It is a fraction of the size of the letters, and it has to be: words that wrap are ragged, and the
 * space at the end of a line is centred along with the letters before it, so painted letters are never
 * symmetrically placed to the pixel. What is being ruled out is a label that is not centred at all —
 * sitting in a corner of the shape, which at this size is out by two hundred pixels.
 */
const CENTRE_SLACK = TEXT_SIZES[DEFAULT_TEXT_SIZE] * 2 * 0.15;

test('TC-23: a drag with the Shape tool makes the box the mouse travelled, at 100%', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  const camera = await settled(page);
  expect(camera.zoom, 'the design runs this case at 100%').toBe(1);

  await armShapeTool(page);

  await drawShape(page, DRAG_FROM, DRAG_TO);

  await expect.poll(() => shapesOnPage(page).then((shapes) => shapes.length)).toBe(1);
  const shape = (await shapesOnPage(page))[0];
  expect(shape.type).toBe('shape');
  expect(shape.kind, 'the Shape tool starts on the rectangle').toBe('rect');

  // The box is the box the pointer travelled: 200 by 120 board units, starting where the press was.
  expectPixels(shape.x, DRAG_FROM.x, 'the shape starts where the pointer went down');
  expectPixels(shape.y, DRAG_FROM.y, 'the shape starts where the pointer went down');
  expectPixels(shape.width, DRAG_TO.x - DRAG_FROM.x, 'its width is how far the pointer travelled sideways');
  expectPixels(shape.height, DRAG_TO.y - DRAG_FROM.y, 'its height is how far the pointer travelled downwards');

  // And it is painted there, in pixels, on this screen.
  const painted = await shapePainted(page, shape.id);
  const expected = expectedPainted(camera, shape);
  expectPixels(painted.x, expected.x, 'painted left');
  expectPixels(painted.y, expected.y, 'painted top');
  expectPixels(painted.width, 200, 'painted width, at 100% the same number of pixels as board units');
  expectPixels(painted.height, 120, 'painted height');

  // Drawing is done: the tool has handed the board back to Select, and what was just made is what
  // is selected, so the next thing the person does is to it.
  await expect.poll(() => toolOf(page)).toBe('select');
  expect(await page.locator(`[data-shape-id="${shape.id}"]`).getAttribute('data-selected')).toBe('true');
});

test('TC-23b: a drag too small to be a shape makes a whole shape anyway, centred on where the pointer went down', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  const camera = await settled(page);

  await armShapeTool(page);
  // A press and a release a few pixels apart is a hand that slipped or a person who wanted a shape
  // and clicked. Either way it is not a shape three units wide, which is what the box swept would be.
  const start = await worldToScreen(camera, DRAG_FROM);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y + 3, { steps: 2 });
  await page.mouse.up();
  await settled(page);

  await expect.poll(() => shapesOnPage(page).then((shapes) => shapes.length)).toBe(1);
  const shape = (await shapesOnPage(page))[0];
  expectPixels(shape.width, SHAPE_DEFAULT_SIZE_WORLD, 'the shape is the size the settings give a click');
  expectPixels(shape.height, SHAPE_DEFAULT_SIZE_WORLD, 'in both directions');
  // Centred on the place the person aimed at, which is where the pointer first touched the board —
  // the few pixels it travelled afterwards are a hand arriving, not a place being chosen.
  expectPixels(shape.x + shape.width / 2, DRAG_FROM.x, 'centred on where the pointer went down, sideways');
  expectPixels(shape.y + shape.height / 2, DRAG_FROM.y, 'and downwards');
  await expect.poll(() => toolOf(page)).toBe('select');
});

test('TC-24: a click with the Diamond kind makes a diamond the settings say, centred on the click; its words wrap, and stay centred when the shape is grown', async ({ page }) => {
  await openBoard(page);
  // 200%, framed so the place being clicked lands in the middle of the screen.
  await setCamera(page, { x: CLICK_AT.x - 320, y: CLICK_AT.y - 200, zoom: 2 });
  const camera = await settled(page);
  expect(camera.zoom, 'the design runs this case at 200%').toBe(2);

  await armShapeTool(page, 'diamond');
  await expect(shapeKindMenu(page)).toBeVisible();

  await clickShape(page, CLICK_AT);

  await expect.poll(() => shapesOnPage(page).then((shapes) => shapes.length)).toBe(1);
  const shape = (await shapesOnPage(page))[0];
  expect(shape.kind).toBe('diamond');
  expectPixels(shape.width, SHAPE_DEFAULT_SIZE_WORLD, 'a click makes a shape the size the settings give it');
  expectPixels(shape.height, SHAPE_DEFAULT_SIZE_WORLD, 'the same height as its width');
  expectPixels(shape.x, CLICK_AT.x - SHAPE_DEFAULT_SIZE_WORLD / 2, 'the shape is centred on the click, not started there');
  expectPixels(shape.y, CLICK_AT.y - SHAPE_DEFAULT_SIZE_WORLD / 2, 'on both axes');

  const painted = await shapePainted(page, shape.id);
  const expected = expectedPainted(camera, shape);
  expectPixels(painted.x, expected.x, 'painted left');
  expectPixels(painted.y, expected.y, 'painted top');
  expectPixels(painted.width, SHAPE_DEFAULT_SIZE_WORLD * 2, 'at 200% the shape covers twice its board units in pixels');
  expectPixels(painted.height, SHAPE_DEFAULT_SIZE_WORLD * 2, 'in both directions');
  expect(await page.locator(`[data-shape-id="${shape.id}"]`).getAttribute('data-shape-kind'), 'the diamond is drawn as a diamond').toBe('diamond');

  // The kind menu was the Shape tool's, and it went away when the tool did.
  await expect.poll(() => toolOf(page)).toBe('select');
  await expect(shapeKindMenu(page)).toHaveCount(0);

  // Words longer than the shape is wide. The shape does not grow to fit them and they do not run out
  // of its sides: they are laid out on more lines, inside the box.
  await typeShapeLabel(page, shape.id, A_LONG_NAME);
  const before = await wordsLayout(page, shape.id);
  expect(before.text).toBe(A_LONG_NAME);
  expect(before.lines, 'the words are drawn on more than one line').toBeGreaterThan(1);
  expect(Math.abs(before.offCentre.x), 'the words are centred in the shape').toBeLessThanOrEqual(CENTRE_SLACK);
  expect(before.spills, 'no word runs out of the side of the shape').toBe(false);
  expectPixels(
    (await shapeOnPage(page, shape.id)).height,
    SHAPE_DEFAULT_SIZE_WORLD,
    'and the shape does not grow to fit the words: it stayed the size it was drawn at',
  );

  // Grow the shape by its handle: 200 screen pixels at 200% is 100 board units.
  await resizeSelected(page, 'se', { x: 200, y: 200 });

  const after = await shapeOnPage(page, shape.id);
  expect(after.width, 'the shape grew by what the handle was dragged, divided by the zoom').toBeCloseTo(shape.width + 100, 0);
  expect(after.height).toBeCloseTo(shape.height + 100, 0);

  const grown = await wordsLayout(page, shape.id);
  expect(grown.text, 'growing a shape does not touch its words').toBe(A_LONG_NAME);
  expect(grown.lines, 'and they are still wrapped, not suddenly on one line').toBeGreaterThan(1);
  expect(grown.lines, 'with room to spare, they have fewer lines than they needed before').toBeLessThan(before.lines);
  expect(Math.abs(grown.offCentre.x), 'still centred across the shape').toBeLessThanOrEqual(CENTRE_SLACK);
  expect(Math.abs(grown.offCentre.y), 'still centred down it').toBeLessThanOrEqual(CENTRE_SLACK);
  expect(grown.spills, 'and still inside it').toBe(false);

  // A shape that has been typed into still answers to the tool that made it: pressing S arms the
  // Shape tool again, which is how a person draws the next box.
  await page.keyboard.press('s');
  await expect(page.getByTestId('shape-tool')).toBeVisible();
  await putToolDown(page);
});
