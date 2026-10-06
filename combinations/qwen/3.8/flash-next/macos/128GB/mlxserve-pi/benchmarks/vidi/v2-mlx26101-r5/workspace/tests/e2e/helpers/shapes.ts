/**
 * Shapes, seen from a browser.
 *
 * Everything here is read out of what the page drew — the same way `helpers/board.ts` reads a sticky note
 * out of the `data-` attributes on its element. A shape carries its four numbers, its kind and its two
 * colours on the element that shows it, so a test can compare what a person would compare: where the box
 * is, how big it is, what it is filled with, what is written on it. Nothing here reaches into the page's
 * `Y.Doc`, because a person standing at a browser cannot do that either, and a test that can see more than
 * a person can is testing the wrong thing.
 *
 * The drawing half of this file is deliberately written the way a hand works: press, move in steps,
 * release. The board decides from those pointer events alone whether a gesture was a drag or a click, and
 * that decision is half of what story 10 is about — so it is made here by a real mouse rather than by
 * calling `createShape` and hoping the tool would have done the same.
 */

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { ShapeKind } from '../../../src/shared/objects/shape';
import { board, objectOf, readCamera, settled } from './board';

/** The three kinds, in the order the toolbar lists them. */
export const KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'diamond'];

/** One shape, by id. */
export const shape = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="shape-object"][data-object-id="${id}"]`);

/** The words written on one shape, as drawn (the box being typed into is a different element). */
export const shapeLabel = (page: Page, id: string): Locator => shape(page, id).locator('.shape-object-label');

/** The box a person types a shape's label into; there is at most one on a board. */
export const shapeEditor = (page: Page): Locator => page.getByTestId('shape-editor');

/** The two rows of swatches belonging to the one selected shape. */
export const shapeToolbar = (page: Page): Locator => page.getByTestId('shape-toolbar');

/** The dashed rectangle the Shape tool draws while the pointer is dragging a new shape. */
export const shapePreview = (page: Page): Locator => page.getByTestId('shape-preview');

/** The three kind buttons, shown while the Shape tool is the pointer. */
export const shapeKindButtons = (page: Page): Locator => page.getByTestId('toolbar-shape-kinds');

/** Ids of every shape on the board, in stacking order. */
export function shapeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="shape-object"]')
    .evaluateAll((els) => els.map((el) => el.dataset['objectId'] ?? ''));
}

/** How many shapes are on the board. */
export function shapeCount(page: Page): Promise<number> {
  return page.locator('[data-testid="shape-object"]').count();
}

/** Waits for the board to have drawn this many shapes, and returns their ids. */
export async function expectShapeCount(page: Page, count: number): Promise<string[]> {
  await expect(page.locator('[data-testid="shape-object"]'), `waiting for ${count} shapes`).toHaveCount(
    count,
  );
  return shapeIds(page);
}

/** The one shape on a board that has exactly one shape on it. */
export async function onlyShapeId(page: Page): Promise<string> {
  const ids = await expectShapeCount(page, 1);
  return ids[0] as string;
}

/** One shape's numbers, colours and words, in world units, as the page holds them. */
export function shapeWorld(
  page: Page,
  id: string,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  kind: ShapeKind;
  fill: string;
  fillColor: string;
  stroke: string;
  strokeColor: string;
  text: string;
  interaction: string;
}> {
  return shape(page, id).evaluate((el) => ({
    x: Number(el.dataset['x']),
    y: Number(el.dataset['y']),
    width: Number(el.dataset['width']),
    height: Number(el.dataset['height']),
    z: Number(el.dataset['z']),
    kind: el.dataset['kind'] as ShapeKind,
    fill: el.dataset['fill'] ?? '',
    fillColor: el.dataset['fillColor'] ?? '',
    stroke: el.dataset['stroke'] ?? '',
    strokeColor: el.dataset['strokeColor'] ?? '',
    text: el.dataset['text'] ?? '',
    interaction: el.dataset['interaction'] ?? '',
  }));
}

/** Where a shape is on the screen, at its centre — the box a person would see and click in. */
export async function shapeScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const box = await shape(page, id).boundingBox();
  if (!box) throw new Error(`shape ${id} is not on screen`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** The shape's centre on the screen, which is where a shape is grabbed and where an arrow is aimed. */
export async function shapeCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await shapeScreenBox(page, id);
  return { x: box.cx, y: box.cy };
}

/** What the board's pointer is, from the board's own attribute. */
export function toolOnScreen(page: Page): Promise<string> {
  return board(page)
    .getAttribute('data-tool')
    .then((value) => value ?? 'select');
}

/** Enters a tool with its letter, and waits until the board says it is standing in it. */
export async function enterTool(page: Page, tool: 'select' | 'text' | 'shape' | 'connector'): Promise<void> {
  const letter = { select: 'v', text: 't', shape: 's', connector: 'l' } as const;
  await page.keyboard.press(letter[tool]);
  await expectTool(page, tool);
}

/** Waits for the board's own attribute to say which tool the pointer is in. */
export async function expectTool(page: Page, tool: string): Promise<void> {
  await expect.poll(() => toolOnScreen(page), { message: `waiting for the ${tool} tool` }).toBe(tool);
}

/** The dashed rectangle as the page draws it, in screen pixels; null when no drag is going on. */
export async function previewBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const preview = shapePreview(page);
  if ((await preview.count()) === 0) return null;
  return preview.evaluate((el) => ({
    x: Number(el.dataset['x']),
    y: Number(el.dataset['y']),
    width: Number(el.dataset['width']),
    height: Number(el.dataset['height']),
  }));
}

/** Chooses which shape the Shape tool draws next, from the three buttons the tool grows. */
export async function pickShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  const button = page.getByTestId(`shape-kind-${kind}`);
  await button.click();
  await expect(button, `waiting for the ${kind} kind to be the one lit`).toHaveAttribute('aria-pressed', 'true');
}

/** Which of the three kind buttons is lit. */
export async function shapeKindOnScreen(page: Page): Promise<string | null> {
  for (const kind of KINDS) {
    const button = page.getByTestId(`shape-kind-${kind}`);
    if ((await button.count()) > 0 && (await button.getAttribute('aria-pressed')) === 'true') return kind;
  }
  return null;
}

/** Presses, moves in steps, releases: one gesture, the way a hand makes one. */
async function gesture(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  whileDown?: () => Promise<void>,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Two moves rather than one: the board sees the pointer travel, which is what makes a drag a drag.
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 4 });
  if (whileDown) await whileDown();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await settled(page);
}

/**
 * Draws a shape by dragging, with the Shape tool, and hands back the id of the shape that appeared.
 *
 * The two points are screen pixels — what the mouse is given — and the test compares the shape's world
 * numbers against the camera's own arithmetic, so a mistake about which space a number lives in shows up
 * here rather than being hidden by a helper that converted it quietly.
 */
export async function drawShapeByDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { kind?: ShapeKind; shift?: boolean; whileDown?: () => Promise<void> } = {},
): Promise<string> {
  if (options.kind !== undefined) await pickShapeKind(page, options.kind);
  const before = await shapeIds(page);
  if (options.shift) await page.keyboard.down('Shift');
  await gesture(page, from, to, options.whileDown);
  if (options.shift) await page.keyboard.up('Shift');
  return theNewShape(page, before);
}

/** Draws a shape by clicking, which makes the standard shape centred on that point. */
export async function drawShapeByClick(
  page: Page,
  at: { x: number; y: number },
  options: { kind?: ShapeKind } = {},
): Promise<string> {
  if (options.kind !== undefined) await pickShapeKind(page, options.kind);
  const before = await shapeIds(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
  return theNewShape(page, before);
}

/** The shape that was not there a moment ago. There is only ever one of these, because a gesture makes one. */
async function theNewShape(page: Page, before: readonly string[]): Promise<string> {
  await expect(
    shapeIds(page),
    'waiting for the gesture to leave a shape on the board',
  ).resolves.not.toEqual(before);
  const after = await shapeIds(page);
  const created = after.filter((id) => !before.includes(id));
  if (created.length !== 1) throw new Error(`the gesture made ${created.length} shapes, not one`);
  return created[0] as string;
}

/** Clicks a fill swatch on the selected shape's toolbar. */
export async function pickFill(page: Page, colour: string): Promise<void> {
  await page.getByTestId(`fill-${colour}`).click();
  await settled(page);
}

/** Clicks an outline swatch on the selected shape's toolbar. */
export async function pickStroke(page: Page, colour: string): Promise<void> {
  await page.getByTestId(`stroke-${colour}`).click();
  await settled(page);
}

/** Whether a swatch says it is the colour the shape already is. */
export async function swatchIsLit(page: Page, testId: string): Promise<boolean> {
  const swatch = page.getByTestId(testId);
  return (await swatch.count()) > 0 && (await swatch.getAttribute('aria-pressed')) === 'true';
}

/** The words on a shape, as the board draws them — empty while somebody is typing them. */
export async function shapeText(page: Page, id: string): Promise<string> {
  const label = shapeLabel(page, id);
  if ((await label.count()) === 0) return '';
  return (await label.textContent()) ?? '';
}

/**
 * The box the label is drawn in, and how many lines the words fill, both on the screen.
 *
 * These are what a wrapped, centred label is made of: the words are centred inside the box, the box is the
 * shape, and a label that wrapped is a label whose words are drawn on more than one line.
 */
export async function labelBox(
  page: Page,
  id: string,
): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  linePx: number;
  fontPx: number;
  lines: number;
}> {
  const measured = await shapeLabel(page, id).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const lineHeight =
      style.lineHeight === 'normal' ? Number.parseFloat(style.fontSize) * 1.2 : Number.parseFloat(style.lineHeight);
    // The words, not the box they are centred in. A range over the label's contents gives one rectangle per
    // line the words are actually drawn on, which is what "it wrapped" means: the label element itself is
    // as tall as the shape it is in, whatever it says.
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5).length;
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      lineHeight,
      fontSize: Number.parseFloat(style.fontSize),
      lines,
    };
  });
  return {
    x: measured.x,
    y: measured.y,
    width: measured.width,
    height: measured.height,
    cx: measured.x + measured.width / 2,
    cy: measured.y + measured.height / 2,
    linePx: measured.lineHeight,
    fontPx: measured.fontSize,
    lines: measured.lines,
  };
}

/** The size the label's words are drawn at, in CSS pixels. */
export function labelFontPx(page: Page, id: string): Promise<number> {
  return shapeLabel(page, id).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
}

/** A world point as a screen point, by the camera the page is rendering. */
export async function screenOf(page: Page, world: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const camera = await readCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** The object element of anything on the board, exported here so a spec reads the same for every object. */
export { objectOf };
