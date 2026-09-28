// Story 10 end-to-end, shapes: draw a shape by dragging with the Shape tool open,
// write a label into it, choose which of the three kinds the next shape is, paint
// it - and see all of it again after the page is reloaded, in a real browser,
// against the real room.
//
// TC-23 and TC-24 of the design, plus the persistence half of the style rule.
//
// Everything is measured the way a person sees it: screen pixels for the pointer,
// the object's own rendered box for the result, read back in world units through
// the live camera. Shapes are always found by the id each one carries, never by a
// DOM position, because drawing a second shape changes the paint order and an index
// would then name a different shape.
//
// The board's chrome is avoided on purpose: the tool column is on the left, the zoom
// controls bottom-right, the share button top-right, and the style bar of the
// selected shape floats just above it - so every drag here starts well right of the
// tool column, and each creation is followed by a deselect before the next one.
import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, getCamera, type Cam } from './helpers/sticky.ts';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config.ts';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const screenOf = (cam: Cam, p: { x: number; y: number }) => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

const shapeCenterScreen = async (page: Page, world: Box) => {
  const cam = await getCamera(page);
  return screenOf(cam, { x: world.x + world.width / 2, y: world.y + world.height / 2 });
};

// Only the root element of each shape carries the kind; the graphic, the label and
// the editor are separate elements under it.
const shapeEls = (page: Page) => page.locator('[data-testid^="shape-"][data-shape-kind]');

/** A shape's world box, read from the inline styles the world layer sets. */
async function shapeBox(page: Page, nth = 0): Promise<Box & { kind: string; fill: string; stroke: string; selected: string }> {
  const el = shapeEls(page).nth(nth);
  return el.evaluate((e) => ({
    x: parseFloat((e as HTMLElement).style.left),
    y: parseFloat((e as HTMLElement).style.top),
    width: parseFloat((e as HTMLElement).style.width),
    height: parseFloat((e as HTMLElement).style.height),
    kind: (e as HTMLElement).dataset.shapeKind ?? '',
    fill: (e as HTMLElement).dataset.fill ?? '',
    stroke: (e as HTMLElement).dataset.stroke ?? '',
    selected: (e as HTMLElement).dataset.selected ?? '',
  }));
}

/** Press S and drag a box on the board: the Shape tool's whole job, in one call. */
async function drawShape(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const a = screenOf(cam, fromWorld);
  const b = screenOf(cam, toWorld);
  await page.keyboard.press('s');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
}

/** Choose the kind the next shape will be, from the Shape button's own menu. */
async function pickKind(page: Page, kind: 'rect' | 'ellipse' | 'diamond'): Promise<void> {
  await page.keyboard.press('Escape'); // let go of any selection: the menu follows the tool
  await page.click('[data-testid="tool-shape"]');
  await expect(page.getByTestId('shape-kind-menu')).toBeVisible();
  await page.click(`[data-testid="shape-kind-${kind}"]`);
  await expect(page.getByTestId('shape-kind-menu')).toBeHidden();
}

/** Deselect, so the style bar floating over a shape is out of the next drag's way. */
async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
}

// TC-23: a dragged shape is a shape, a double-click writes a label into it, and a
// reload brings both back exactly as they were.
test('TC-23 draws a shape by dragging, labels it, and keeps it across a reload', async ({ page }) => {
  await gotoBoard(page);

  await drawShape(page, { x: 100, y: 60 }, { x: 300, y: 180 });

  await expect(shapeEls(page)).toHaveCount(1);
  const drawn = await shapeBox(page);
  expect(drawn.kind).toBe('rect');
  expect(drawn.width).toBeCloseTo(200, 0);
  expect(drawn.height).toBeCloseTo(120, 0);
  expect(drawn.x).toBeCloseTo(100, 0);
  expect(drawn.y).toBeCloseTo(60, 0);
  // The board's own defaults, and the tool has handed the board back with the new
  // shape in hand.
  expect(drawn.fill).toBe('white');
  expect(drawn.stroke).toBe('dark');
  expect(drawn.selected).toBe('true');

  // A double-click opens the label where the shape is, and the words are centred
  // in it because that is where a shape's label belongs.
  const box = await shapeBox(page);
  const center = await shapeCenterScreen(page, box);
  await page.mouse.dblclick(center.x, center.y);
  const editor = page.getByTestId('shape-editor');
  await expect(editor).toBeVisible();
  await page.keyboard.type('Ship it');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid^="shape-label-"]')).toHaveText('Ship it');

  // The label did not resize the shape: a shape keeps the box it was drawn with.
  const labelled = await shapeBox(page);
  expect(labelled.width).toBeCloseTo(box.width, 0);
  expect(labelled.height).toBeCloseTo(box.height, 0);

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');

  await expect(shapeEls(page)).toHaveCount(1);
  const kept = await shapeBox(page);
  expect(kept.x).toBeCloseTo(box.x, 0);
  expect(kept.y).toBeCloseTo(box.y, 0);
  expect(kept.width).toBeCloseTo(box.width, 0);
  expect(kept.height).toBeCloseTo(box.height, 0);
  await expect(page.locator('[data-testid^="shape-label-"]')).toHaveText('Ship it');
});

// A click - a drag of nowhere - lands the standard size centred on the point that
// was pressed, which is the only way to get a shape without measuring anything.
test('a click with the Shape tool lands the standard size on the point', async ({ page }) => {
  await gotoBoard(page);

  const cam = await getCamera(page);
  const at = screenOf(cam, { x: 300, y: 100 });
  await page.keyboard.press('s');
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

  await expect(shapeEls(page)).toHaveCount(1);
  const shape = await shapeBox(page);
  expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
  expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
  expect(shape.x + shape.width / 2).toBeCloseTo(300, 0);
  expect(shape.y + shape.height / 2).toBeCloseTo(100, 0);
});

// TC-24: the three kinds, and the choice kept for the next shape.
test('TC-24 draws all three kinds and remembers the one that was chosen', async ({ page }) => {
  await gotoBoard(page);

  // The menu is part of the tool: pressing S shows the three kinds.
  await page.keyboard.press('s');
  await expect(page.getByTestId('shape-kind-menu')).toBeVisible();
  await expect(page.getByTestId('shape-kind-rect')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('shape-kind-ellipse')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape'); // leaving the tool takes the menu with it
  await expect(page.getByTestId('shape-kind-menu')).toHaveCount(0);

  // An ellipse, chosen.
  await pickKind(page, 'ellipse');
  await drawShape(page, { x: 0, y: 0 }, { x: 200, y: 140 });
  await expect(shapeEls(page)).toHaveCount(1);
  expect((await shapeBox(page, 0)).kind).toBe('ellipse');
  await deselect(page);

  // A second ellipse, chosen by nobody: the kind was kept.
  await drawShape(page, { x: 300, y: 0 }, { x: 500, y: 140 });
  const second = await shapeBox(page, 1);
  expect(second.kind).toBe('ellipse');
  // The menu, reopened, says so.
  await page.click('[data-testid="tool-shape"]');
  await expect(page.getByTestId('shape-kind-ellipse')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await deselect(page);

  // A diamond, chosen.
  await pickKind(page, 'diamond');
  await drawShape(page, { x: 600, y: 0 }, { x: 800, y: 140 });
  const third = await shapeBox(page, 2);
  expect(third.kind).toBe('diamond');

  // What each kind is drawn as: the figure the browser is actually painting.
  await expect(shapeEls(page)).toHaveCount(3);
  const figures = await page.$$eval('[data-testid^="shape-figure-"]', (els) => els.map((e) => e.tagName.toLowerCase()));
  expect(figures).toEqual(['ellipse', 'ellipse', 'polygon']);

  // The rectangles keep the boxes they were drawn with - the ellipse and the diamond
  // included, which is what story 7's handles and the connectors' anchors use.
  const boxes: Box[] = [];
  for (let i = 0; i < 3; i++) boxes.push(await shapeBox(page, i));
  expect(boxes.map((b) => Math.round(b.width))).toEqual([200, 200, 200]);
});

// The style bar of one selected shape, and nothing else: fill and outline are the
// shape's own two colours, chosen from swatches, one undo step each.
test('paints a shape from its own toolbar and keeps the paint across a reload', async ({ page }) => {
  await gotoBoard(page);

  await drawShape(page, { x: 100, y: 60 }, { x: 300, y: 180 });
  await expect(page.getByTestId('shape-toolbar')).toBeVisible();
  // The palettes the design names: seven fills counting 'none', six outlines.
  // One button per palette entry: 'none' is one of the fills, and has no match
  // among the outlines.
  expect(await page.locator('button[data-testid^="shape-fill-"]').count()).toBe(Object.keys(SHAPE_FILL_COLORS).length);
  expect(await page.locator('button[data-testid^="shape-stroke-"]').count()).toBe(Object.keys(SHAPE_STROKE_COLORS).length);

  await page.click('[data-testid="shape-fill-blue"]');
  await page.click('[data-testid="shape-stroke-red"]');
  await expect(async () => {
    const painted = await shapeBox(page);
    expect(painted.fill).toBe('blue');
    expect(painted.stroke).toBe('red');
  }).toPass();

  // One undo step takes back the outline, and only the outline.
  await page.keyboard.press('Control+z');
  await expect(async () => {
    const undone = await shapeBox(page);
    expect(undone.stroke).toBe('dark');
    expect(undone.fill).toBe('blue');
  }).toPass();

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  const kept = await shapeBox(page);
  expect(kept.fill).toBe('blue');
  expect(kept.stroke).toBe('dark');
});

// A shape and a sticky are objects of one board: the same marquee picks both, the
// same arrow can join them, and the Shape tool's drag over either one draws a shape
// instead of moving it.
test('draws a shape across a sticky note without moving it', async ({ page }) => {
  await gotoBoard(page);

  // A note, made the way the board makes them.
  const cam = await getCamera(page);
  const noteAt = screenOf(cam, { x: 200, y: 200 });
  await page.mouse.dblclick(noteAt.x, noteAt.y);
  await page.keyboard.type('note');
  await page.keyboard.press('Escape');
  const before = await page.locator('[role="group"][aria-label="Sticky note"]').first().evaluate((e) => ({
    x: parseFloat((e as HTMLElement).style.left),
    y: parseFloat((e as HTMLElement).style.top),
  }));

  // A shape dragged right across the note.
  await drawShape(page, { x: 120, y: 160 }, { x: 420, y: 360 });

  const note = await page.locator('[role="group"][aria-label="Sticky note"]').first().evaluate((e) => ({
    x: parseFloat((e as HTMLElement).style.left),
    y: parseFloat((e as HTMLElement).style.top),
  }));
  expect(note).toEqual(before); // the note never moved
  expect(await shapeEls(page)).toHaveCount(1);
  const shape = await shapeBox(page);
  expect(shape.width).toBeCloseTo(300, 0);
});
