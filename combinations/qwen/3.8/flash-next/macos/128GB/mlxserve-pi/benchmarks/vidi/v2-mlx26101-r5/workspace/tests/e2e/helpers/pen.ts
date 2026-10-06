/**
 * The pen, seen from a browser.
 *
 * Everything here is read out of what the page drew, in the way `helpers/board.ts` reads a sticky note: a
 * drawing carries its box, its colour, its pen and the number of points it holds on the element that shows
 * it, so a test can compare what a person compares — where the line is, how thick it is, whether the line
 * they watched being drawn is the line they got. Nothing here reaches into the page's `Y.Doc`, because a
 * person standing at a browser cannot, and a test that can see more than a person can is testing the wrong
 * thing.
 *
 * Two things in this file have no equivalent in the shape or arrow helpers, and both are because a stroke is
 * made of two hundred pointer events instead of four.
 *
 * One is `drawStroke`, which replays a *recorded path* point by point rather than interpolating between two
 * corners. The paths in `tests/fixtures/pen-paths.ts` are wobbly on purpose — that wobble is what the
 * simplifier is measured against — and a helper that asked Playwright to draw straight lines between a few
 * of its points would be testing a different drawing than the fixture describes. So every point of the path
 * becomes its own mouse move, which is also the only way the thing the tests are really about happens: the
 * page receives pointer events faster than it paints, and the preview is what it managed to paint.
 *
 * The other is the frame sampler. "The preview is updated every animation frame" is a sentence about a
 * sequence of frames, and a test that looks at the preview twice in half a second cannot have seen a frame
 * at all. So the page samples its own preview inside `requestAnimationFrame`, at the frame rate of the
 * browser rather than the round-trip rate of the protocol, and hands the list back afterwards — which is the
 * same trick `helpers/participants.ts` uses for connection states: ask the page to remember, and read what
 * it remembers.
 */

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { PenColor, PenThickness } from '../../../src/shared/config';
import { PEN_COLOR_NAMES, PEN_THICKNESS_NAMES } from '../../../src/shared/config';
import type { Point } from '../../../src/shared/geometry';
import { readCamera, settled } from './board';
import { expectTool, toolOnScreen } from './shapes';

/** Where the page keeps the frames it watched. A name of its own, so it cannot collide with the board's hook. */
const FRAMES = '__vidi6PenFrames';

/* ------------------------------------------------------------------ the pen's own chrome */

/** The tool's layer: the preview and the pen-tip cursor, both screen-fixed, both unclickable. */
export const penLayer = (page: Page): Locator => page.getByTestId('pen-layer');
/** The line being drawn, which exists only while the button is down. */
export const penPreview = (page: Page): Locator => page.getByTestId('pen-preview');
export const penPreviewPath = (page: Page): Locator => page.getByTestId('pen-preview-path');
/** The dot that follows the pointer, the size of the pen it is drawing with. */
export const penCursor = (page: Page): Locator => page.getByTestId('pen-cursor');
/** The two rows of pen choices, shown while the Pen is the tool. */
export const penToolbar = (page: Page): Locator => page.getByTestId('pen-toolbar');

/** Presses the pen's letter and waits until the board says it is standing in it. */
export async function enterPenTool(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expectTool(page, 'pen');
  await expect(penToolbar(page), 'waiting for the pen to grow its options').toBeVisible();
}

/** Leaves the pen with the key that leaves it, and waits for the board's pointer to have gone back. */
export async function leavePenTool(page: Page, key = 'v'): Promise<void> {
  await page.keyboard.press(key);
  await expectTool(page, key === 'Escape' ? 'select' : key === 'p' ? 'pen' : key);
}

/** What the board's pointer is, so a pen test can say "and the pen is still the pen". */
export { toolOnScreen };

/** Chooses the colour the next stroke is drawn in, and waits for the swatch to say it is lit. */
export async function pickPenColor(page: Page, color: PenColor): Promise<void> {
  const swatch = page.getByTestId(`pen-color-${color}`);
  await swatch.click();
  await expect(swatch, `waiting for the ${color} pen to be the one lit`).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Chooses the thickness the next stroke is drawn with. */
export async function pickPenThickness(page: Page, thickness: PenThickness): Promise<void> {
  const button = page.getByTestId(`pen-thickness-${thickness}`);
  await button.click();
  await expect(button, `waiting for the ${thickness} pen to be the one lit`).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Which swatch is lit, or null when the pen has not been asked. */
export async function penColorOnScreen(page: Page): Promise<string | null> {
  for (const name of PEN_COLOR_NAMES) {
    const swatch = page.getByTestId(`pen-color-${name}`);
    if ((await swatch.count()) > 0 && (await swatch.getAttribute('aria-pressed')) === 'true') return name;
  }
  return null;
}

/** Which thickness button is lit. */
export async function penThicknessOnScreen(page: Page): Promise<string | null> {
  for (const name of PEN_THICKNESS_NAMES) {
    const button = page.getByTestId(`pen-thickness-${name}`);
    if ((await button.count()) > 0 && (await button.getAttribute('aria-pressed')) === 'true') return name;
  }
  return null;
}

/* ------------------------------------------------------------------ the drawing itself */

/** One drawing, by id. */
export const stroke = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="stroke-object"][data-object-id="${id}"]`);

/** The ink, as an SVG path — the visible one, which is the drawing. */
export const strokeLine = (page: Page, id: string): Locator =>
  stroke(page, id).locator('[data-testid="stroke-line"]');

/** The invisible stroke over the ink, which is the only part of a drawing a mouse can catch hold of. */
export const strokeHit = (page: Page, id: string): Locator =>
  stroke(page, id).locator('[data-testid="stroke-hit"]');

/** Ids of every drawing on the board, in stacking order. */
export function strokeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="stroke-object"]')
    .evaluateAll((els) => els.map((el) => el.dataset['objectId'] ?? ''));
}

/** How many drawings are on the board. */
export function strokeCount(page: Page): Promise<number> {
  return page.locator('[data-testid="stroke-object"]').count();
}

/** Waits for the board to have drawn this many drawings, and returns their ids. */
export async function expectStrokeCount(page: Page, count: number): Promise<string[]> {
  await expect(page.locator('[data-testid="stroke-object"]'), `waiting for ${count} drawings`).toHaveCount(
    count,
  );
  return strokeIds(page);
}

/** A drawing's numbers, pen and point count, as the page holds them, in world units. */
export interface StrokeState {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  color: string;
  colorValue: string;
  thickness: string;
  /** How many points the drawing holds — the simplified line, not the pointer events it came from. */
  points: number;
  /**
   * Whether the drawing is the one selected.
   *
   * A drawing has no interaction state of its own the way a sticky note or a shape has one — nothing about
   * the ink changes while it is being dragged, because a dragged drawing is a selection box with the same
   * path inside it — so the one thing a test can ask is whether it is the selected one.
   */
  selected: boolean;
}

export function strokeState(page: Page, id: string): Promise<StrokeState> {
  return stroke(page, id).evaluate((el) => ({
    x: Number(el.dataset['x']),
    y: Number(el.dataset['y']),
    width: Number(el.dataset['width']),
    height: Number(el.dataset['height']),
    z: Number(el.dataset['z']),
    color: el.dataset['color'] ?? '',
    colorValue: el.dataset['colorValue'] ?? '',
    thickness: el.dataset['thickness'] ?? '',
    points: Number(el.querySelector('[data-testid="stroke-line"]')?.getAttribute('data-digits') ?? 'NaN'),
    selected: el.dataset['selected'] === 'true',
  }));
}

/** The ink as drawn: its path, its colour and its width, and how wide a pointer can catch it. */
export interface StrokeDrawing {
  d: string;
  stroke: string;
  strokeWidth: number;
  hitWidth: number;
}

export function strokeDrawing(page: Page, id: string): Promise<StrokeDrawing> {
  return stroke(page, id).evaluate((el) => {
    const line = el.querySelector('[data-testid="stroke-line"]');
    const hit = el.querySelector('[data-testid="stroke-hit"]');
    return {
      d: line?.getAttribute('d') ?? '',
      stroke: line?.getAttribute('stroke') ?? '',
      strokeWidth: Number(line?.getAttribute('stroke-width') ?? 'NaN'),
      hitWidth: Number(hit?.getAttribute('stroke-width') ?? 'NaN'),
    };
  });
}

/** A drawing's box on the screen, which is the box around the squiggle and not the squiggle. */
export async function strokeScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const box = await stroke(page, id).boundingBox();
  if (!box) throw new Error(`drawing ${id} is not on screen`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** A box on the screen, in CSS pixels, with its centre worked out. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/** Where the ink itself is on the screen, which is what a click has to hit — and not the box around it. */
export async function inkBox(page: Page, id: string): Promise<ScreenRect> {
  const box = await strokeLine(page, id).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/* ------------------------------------------------------------------ the preview, and the frames it is painted on */

/** The preview as the page draws it, in screen pixels; null between strokes. */
export async function previewState(
  page: Page,
): Promise<{ d: string; tipX: number; tipY: number; width: number } | null> {
  const path = penPreviewPath(page);
  if ((await path.count()) === 0) return null;
  return path.evaluate((el) => ({
    d: el.getAttribute('d') ?? '',
    tipX: Number(el.dataset['x']),
    tipY: Number(el.dataset['y']),
    width: Number(el.getAttribute('stroke-width') ?? 'NaN'),
  }));
}

/** Whether a drawing of this id is on this screen at all — the question a watching browser is asked. */
export function hasStroke(page: Page, id: string): Promise<boolean> {
  return page.evaluate((drawingId) => document.querySelector(`[data-object-id="${drawingId}"]`) !== null, id);
}

/**
 * Starts the page sampling its own preview, once per animation frame.
 *
 * The sampler writes a `d` (or null for "no preview this frame") into an array on `window`, and does nothing
 * else, because it runs sixty times a second in the middle of the gesture being measured: a sampler that
 * queried, compared or copied anything would be a sampler that changed what it was sampling.
 */
export async function startFrameSampler(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const store = window as unknown as Record<string, (string | null)[] | undefined>;
    const frame = window as unknown as { [key: string]: number | undefined };
    store[key] = [];
    const tick = (): void => {
      const path = document.querySelector('[data-testid="pen-preview-path"]');
      (store[key] as (string | null)[]).push(path === null ? null : path.getAttribute('d'));
      frame['__vidi6PenRaf'] = requestAnimationFrame(tick);
    };
    frame['__vidi6PenRaf'] = requestAnimationFrame(tick);
  }, FRAMES);
}

/** The frames the page saw, oldest first; at least one entry per animation frame since the sampler started. */
export function frameSamples(page: Page): Promise<(string | null)[]> {
  return page.evaluate((key) => {
    const store = window as unknown as Record<string, (string | null)[] | undefined>;
    return [...(store[key] ?? [])];
  }, FRAMES);
}

/** Stops the sampler. What was collected stays readable until the page is reloaded. */
export async function stopFrameSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frame = window as unknown as { __vidi6PenRaf?: number };
    if (frame.__vidi6PenRaf !== undefined) cancelAnimationFrame(frame.__vidi6PenRaf);
    frame.__vidi6PenRaf = undefined;
  });
}

/** How many times a list of frames changed from one frame to the next, counting only frames with a line in. */
export function frameChanges(frames: readonly (string | null)[]): number {
  let changes = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    if (before !== null && after !== null && before !== after) changes += 1;
  }
  return changes;
}

/** How many frames held a preview at all. */
export function framesWithLine(frames: readonly (string | null)[]): number {
  return frames.filter((d) => d !== null && d !== '').length;
}

/* ------------------------------------------------------------------ drawing a stroke */

/** A world point as this page draws it, by the camera it is rendering. */
export async function screenOfWorld(page: Page, world: Point): Promise<Point> {
  const camera = await readCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** A recorded path, converted into screen pixels by the camera the page is rendering. */
export async function screenPath(page: Page, path: readonly Point[]): Promise<Point[]> {
  const camera = await readCamera(page);
  return path.map((point) => ({
    x: (point.x - camera.x) * camera.zoom,
    y: (point.y - camera.y) * camera.zoom,
  }));
}

export interface StrokeGesture {
  /** Chosen before the stroke is drawn, because the pen's options are the pen's and not the stroke's. */
  color?: PenColor;
  thickness?: PenThickness;
  /** Runs with the pen still down: the only moment a preview exists to be looked at. */
  whileDown?: () => Promise<void>;
  /** Set when the gesture is meant to draw nothing, so the helper does not go looking for a stroke. */
  expectNothing?: boolean;
}

/**
 * Draws a recorded path with the pen, and hands back the id of the drawing that appeared.
 *
 * One mouse move per recorded point, and no interpolation: the path is the thing under test, and a helper
 * that drew straight lines between every fourth point of a wobbly circle would be testing the four points.
 * The pen is entered first if it is not already the tool, which is what a person does with the letter on
 * their keyboard.
 */
export async function drawStroke(
  page: Page,
  path: readonly Point[],
  options: StrokeGesture = {},
): Promise<string | null> {
  // The tool first: the pen's swatches are only on the screen while the pen is the tool, so a helper that
  // reached for a colour before the pen was lit would be waiting for a swatch that cannot exist.
  if ((await toolOnScreen(page)) !== 'pen') await enterPenTool(page);
  if (options.color !== undefined) await pickPenColor(page, options.color);
  if (options.thickness !== undefined) await pickPenThickness(page, options.thickness);

  const before = await strokeIds(page);
  const screen = await screenPath(page, path);
  const first = screen[0] as Point;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of screen.slice(1)) await page.mouse.move(point.x, point.y);
  if (options.whileDown !== undefined) await options.whileDown();
  const last = screen[screen.length - 1] as Point;
  await page.mouse.move(last.x, last.y);
  await page.mouse.up();
  await settled(page);

  if (options.expectNothing === true) return null;
  return theNewStroke(page, before);
}

/** The drawing that was not there a moment ago — and there is only ever one of those. */
export async function theNewStroke(page: Page, before: readonly string[]): Promise<string> {
  await expect(
    strokeIds(page),
    'waiting for the pen to leave a drawing on the board',
  ).resolves.not.toEqual(before);
  const created = (await strokeIds(page)).filter((id) => !before.includes(id));
  if (created.length !== 1) throw new Error(`the pen made ${created.length} drawings, not one`);
  return created[0] as string;
}

/**
 * Presses and lifts at a point: the way a drawing is selected, which is by its line and not by its box.
 *
 * No drawing id, because nothing here needs one. Where the mouse goes decides what gets hold of it, and
 * that decision — the browser's own hit test, over an invisible stroke and whatever else is under the
 * pointer — is the thing the tests are about.
 */
export async function clickStroke(page: Page, world: Point): Promise<void> {
  const at = await screenOfWorld(page, world);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
}

/**
 * Drags from a point on the line, by a screen delta: a move of whatever that point belongs to.
 *
 * The point has to be a point *of the line*, which is the whole reason this helper exists: the middle of a
 * drawing's box is the middle of whatever the drawing was drawn round, and a mouse press there is a press on
 * the board. As with {@link clickStroke}, the id is left out rather than passed and ignored.
 */
export async function dragStroke(page: Page, world: Point, dx: number, dy: number): Promise<void> {
  const at = await screenOfWorld(page, world);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx * 0.3, at.y + dy * 0.3, { steps: 3 });
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 });
  await page.mouse.up();
  await settled(page);
}

/** Waits until a drawing's numbers stop moving, then returns them: the same rule as any other object. */
export async function waitForStrokeAtRest(page: Page, id: string): Promise<StrokeState> {
  let last = await strokeState(page, id);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await page.waitForTimeout(20);
    const next = await strokeState(page, id);
    if (
      next.x === last.x &&
      next.y === last.y &&
      next.width === last.width &&
      next.height === last.height &&
      next.z === last.z
    ) {
      return next;
    }
    last = next;
  }
  return last;
}
