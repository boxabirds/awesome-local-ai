/**
 * Helpers for story 11's end-to-end tests: a pen that draws on a real screen, and what the board then
 * lets you do to the line it left.
 *
 * Three rules run through this file, and they are the rules of the tests that use it.
 *
 * **Board units and screen pixels are converted, never conflated.** A path is given in board units, because
 * that is what a person draws on; the mouse is moved in screen pixels, which is what this page's camera says
 * those board units are. The camera is set by the test and read back before it is used, so nothing here
 * assumes where the board happens to be looking. What is asserted is read out of the page's own document —
 * which speaks board units — or measured off the painted page in pixels and compared with what this page's
 * camera says those units should be.
 *
 * **A recording is replayed, not re-typed.** The paths come from `tests/fixtures/pen-paths.ts`, which holds
 * what a hand actually made: the wobble is the point, because a drag along a perfect straight line would pass
 * with a pen that threw away every point but the ends. They are thinned on the way to the mouse
 * ({@link retrace}) for one reason and one only: each `mouse.move` is a round trip to the browser, and four
 * hundred of them is a slow test rather than a thorough one. The thinning keeps the shape — every point it
 * drops is within a few pixels of the line that survives, which is the same promise the smoothing makes to the
 * document.
 *
 * **The preview belongs to the page that draws it.** Everything a test wants to know about a stroke in flight
 * is asked of this page's own document, which is the honest witness for the claim "nobody else can see this
 * yet": the drawing is not in the document until the pointer lets go, and on somebody else's screen the
 * document is all there is.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import type { StrokeSnap } from '../../../src/shared/objects/stroke';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../../src/shared/config';
import type { Point } from './board';
import { BOARD_AREA, getCamera, settled, worldToScreen } from './board';

/** A box on the screen, as the browser painted it. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A camera that puts the board where a test wants it, away from the toolbar. */
export const PLAIN = { x: -400, y: -250, zoom: 1 };

/** The same, at half size: the zoom the design's hit-tolerance cases are written at. */
export const FAR = { x: -400, y: -250, zoom: 0.5 };

/** Anywhere on the board, in board units, for a test that needs a place and not a position. */
export const OPEN_SPACE = { x: 520, y: 430 };

/** How many points a replayed path is thinned to: enough for a curve to be a curve. */
const REPLAY_POINTS = 90;

// ---------------------------------------------------------------------------
// The document this page holds
// ---------------------------------------------------------------------------

/** The drawings this page's document holds. The model's own snapshot, not a reading of the DOM. */
export async function strokesOnPage(page: Page): Promise<readonly StrokeSnap[]> {
  return page.evaluate(() => window.__vidi6?.getStrokes() ?? []);
}

export async function strokeOnPage(page: Page, id: string): Promise<StrokeSnap> {
  const stroke = (await strokesOnPage(page)).find((entry) => entry.id === id);
  if (stroke === undefined) throw new Error(`this page's document has no drawing ${id}`);
  return stroke;
}

/** Where a drawing's points are on the board *now*, which is what a pointer has to be aimed at. */
export async function strokePoints(page: Page, id: string): Promise<readonly Point[]> {
  return page.evaluate((strokeId) => {
    const stroke = (window.__vidi6?.getStrokes() ?? []).find((entry) => entry.id === strokeId);
    if (stroke === undefined) return [];
    const scaleX = stroke.width / stroke.baseWidth;
    const scaleY = stroke.height / stroke.baseHeight;
    const points: Point[] = [];
    for (let index = 0; index + 1 < stroke.points.length; index += 2) {
      points.push({ x: stroke.x + stroke.points[index] * scaleX, y: stroke.y + stroke.points[index + 1] * scaleY });
    }
    return points;
  }, id);
}

/** The tool this page says it is in, as the board reports it on its own surface. */
export async function toolOf(page: Page): Promise<string | null> {
  return boardAttribute(page, 'data-active-tool');
}

async function boardAttribute(page: Page, name: string): Promise<string | null> {
  return page.getByTestId('board-viewport').getAttribute(name);
}

// ---------------------------------------------------------------------------
// Arming the pen
// ---------------------------------------------------------------------------

export function penToolButton(page: Page): Locator {
  return page.getByRole('button', { name: /Pen/ });
}

/** The sheet the pen draws on: the whole board, over the objects. */
export function penSheet(page: Page): Locator {
  return page.getByTestId('pen-tool');
}

/** The pen's options, which are on screen only while the pen is. */
export function penToolbar(page: Page): Locator {
  return page.getByTestId('pen-toolbar');
}

export function penColorButton(page: Page, color: string): Locator {
  return page.getByTestId(`pen-color-${color}`);
}

export function penThicknessButton(page: Page, thickness: string): Locator {
  return page.getByTestId(`pen-thickness-${thickness}`);
}

/** What the pen's live region says the pen is set to. */
export async function penStatus(page: Page): Promise<string | null> {
  return penToolbar(page).getByTestId('pen-status').textContent();
}

/** The line being drawn right now, or nothing when the pen is up. */
export function penPreview(page: Page): Locator {
  return page.getByTestId('pen-preview-path');
}

/** Arm the pen by its button, and wait for its sheet: an armed tool is a tool you can press. */
export async function armPenTool(page: Page): Promise<void> {
  await penToolButton(page).click();
  await expect(penSheet(page)).toBeVisible();
}

/** Arm the pen with the keyboard, which is how the design says a pen is picked up. */
export async function armPenToolByKey(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(penSheet(page)).toBeVisible();
}

/** Give the board back. */
export async function putPenDown(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(penSheet(page)).toHaveCount(0);
  await expect(penToolbar(page)).toHaveCount(0);
}

/** Choose an ink, and say which ink this page now believes it is drawing with. */
export async function choosePenColor(page: Page, color: string): Promise<void> {
  await penColorButton(page, color).click();
  await expect(penColorButton(page, color)).toHaveAttribute('aria-pressed', 'true');
}

export async function choosePenThickness(page: Page, thickness: string): Promise<void> {
  await penThicknessButton(page, thickness).click();
  await expect(penThicknessButton(page, thickness)).toHaveAttribute('aria-pressed', 'true');
}

/** Which inks and nibs the panel says are chosen. */
export async function penAriaPressed(page: Page): Promise<{ colors: string[]; thicknesses: string[] }> {
  const names = ['black', 'blue', 'red', 'green', 'orange', 'purple'];
  const nibs = ['thin', 'medium', 'thick'];
  const pressed = async (prefix: string, list: string[]): Promise<string[]> => {
    const chosen: string[] = [];
    for (const name of list) {
      if ((await page.getByTestId(`${prefix}-${name}`).getAttribute('aria-pressed')) === 'true') chosen.push(name);
    }
    return chosen;
  };
  return { colors: await pressed('pen-color', names), thicknesses: await pressed('pen-thickness', nibs) };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Thin a recorded path down to a replayable number of points, keeping where it starts and where it ends.
 *
 * See the header note: this is about the cost of a mouse event, not about the drawing.
 */
export function retrace(path: readonly Point[], target = REPLAY_POINTS): Point[] {
  if (path.length <= target) return path.map((point) => ({ ...point }));
  const stride = path.length / target;
  const kept: Point[] = [];
  for (let at = 0; at < target; at += 1) kept.push({ ...path[Math.floor(at * stride)]! });
  kept.push({ ...path[path.length - 1]! });
  return kept;
}

/**
 * Put the pen down and take it through a recorded path, in board units, leaving it down.
 *
 * Each point is one mouse move, in the pixels this page's camera says that board point is at. The pointer is
 * left down because every interesting thing about a pen happens *while* it is travelling: the preview, what
 * another person can see, what the board underneath is doing. {@link liftPen} finishes the gesture.
 */
export async function lowerPen(page: Page, path: readonly Point[]): Promise<void> {
  const camera = await settled(page);
  const points = retrace(path);
  const first = worldToScreen(camera, points[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const at = worldToScreen(camera, point);
    await page.mouse.move(at.x, at.y);
  }
}

/** Let go, wherever the pen has got to. */
export async function liftPen(page: Page): Promise<void> {
  await page.mouse.up();
  await settled(page);
}

/** Draw a whole path: press, travel, let go. */
export async function drawWithPen(page: Page, path: readonly Point[]): Promise<void> {
  await lowerPen(page, path);
  await liftPen(page);
}

/** Draw a straight line between two board points, which is the shortest thing a pen can draw. */
export async function drawLine(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  const camera = await settled(page);
  const start = worldToScreen(camera, from);
  const end = worldToScreen(camera, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps, start.y + ((end.y - start.y) * step) / steps);
  }
  await page.mouse.up();
  await settled(page);
}

/** Put the pen down and lift it again without travelling: a dot. */
export async function tapPen(page: Page, at: Point): Promise<void> {
  const camera = await settled(page);
  const point = worldToScreen(camera, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
}

// ---------------------------------------------------------------------------
// Sampling the preview, frame by frame
// ---------------------------------------------------------------------------

/**
 * Start collecting the preview's `d` attribute once per animation frame, in the page.
 *
 * This is the only honest way to ask the question the design puts — *does the preview update every animation
 * frame* — because the answer is a thing that happens between paints. The page keeps the samples on `window`
 * and reads them back on {@link previewSamples}; each entry is the `d` that was on screen at that frame, or an
 * empty string on the frames where nothing is being drawn.
 */
export async function watchPreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    const page = window as unknown as { __penPreviewSamples?: string[]; __penWatch?: number };
    page.__penPreviewSamples = [];
    const tick = (): void => {
      const path = document.querySelector('[data-testid="pen-preview-path"]');
      page.__penPreviewSamples!.push(path === null ? '' : (path.getAttribute('d') ?? ''));
      page.__penWatch = requestAnimationFrame(tick);
    };
    page.__penWatch = requestAnimationFrame(tick);
  });
}

/** Stop watching, and hand back what the frames said. */
export async function previewSamples(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const page = window as unknown as { __penPreviewSamples?: string[]; __penWatch?: number };
    if (page.__penWatch !== undefined) cancelAnimationFrame(page.__penWatch);
    const samples = [...(page.__penPreviewSamples ?? [])];
    page.__penPreviewSamples = [];
    return samples;
  });
}

// ---------------------------------------------------------------------------
// Pointing at a drawing, and measuring where it is painted
// ---------------------------------------------------------------------------

export function strokeElement(page: Page, id: string): Locator {
  return page.locator(`[data-stroke-id="${id}"]`);
}

/** The visible line of a drawing. */
export function strokePainted(page: Page, id: string): Locator {
  return strokeElement(page, id).getByTestId('stroke-path');
}

/** The strip a drawing paints to be clicked on. */
export function strokeHit(page: Page, id: string): Locator {
  return strokeElement(page, id).getByTestId('stroke-hit');
}

/**
 * A point on a drawing's line, on this page's screen.
 *
 * A drawing is a line inside a box, so the place to click is asked of the line — the drawing's own points,
 * scaled by whatever the box has since become — and not of the box, which is a rectangle nobody drew.
 */
export async function pointOnStroke(page: Page, id: string, fraction = 0.5): Promise<Point> {
  const points = await strokePoints(page, id);
  if (points.length === 0) throw new Error(`the drawing ${id} has no points to click on`);
  const at = Math.min(points.length - 1, Math.max(0, Math.round((points.length - 1) * fraction)));
  return worldToScreen(await getCamera(page), points[at]!);
}

/** Click a drawing's line: this is what picking a drawing up means. */
export async function selectStroke(page: Page, id: string, fraction = 0.5): Promise<void> {
  const at = await pointOnStroke(page, id, fraction);
  await page.mouse.click(at.x, at.y);
  await settled(page);
}

/** Whether this page says this drawing is the thing that is picked up. */
export async function strokeSelected(page: Page, id: string): Promise<boolean> {
  return (await strokeElement(page, id).getAttribute('data-selected')) === 'true';
}

/** Where a drawing's line is painted, in screen pixels. */
export async function paintedStrokeBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await strokePainted(page, id).boundingBox();
  if (box === null) throw new Error(`the drawing ${id} is not painted on this page`);
  return { x: box.x ?? 0, y: box.y ?? 0, width: box.width ?? 0, height: box.height ?? 0 };
}

/** How a drawing's line is painted: the attributes that say what ink and what nib. */
export async function paintedStrokeStyle(page: Page, id: string): Promise<Record<string, string | null>> {
  const path = strokePainted(page, id);
  const names = ['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill'];
  const style: Record<string, string | null> = {};
  for (const name of names) style[name] = await path.getAttribute(name);
  return style;
}

/** Drag a handle of the selection: the handle is where the selection box says it is. */
export async function dragSelectionHandle(
  page: Page,
  handle: 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w',
  delta: Point,
): Promise<void> {
  const locator = page.getByTestId(`resize-handle-${handle}`);
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`the selection offers no ${handle} handle`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/** Pick a drawing up by its line and carry it somewhere else. */
export async function dragStroke(page: Page, id: string, delta: Point, fraction = 0.5): Promise<void> {
  const at = await pointOnStroke(page, id, fraction);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + delta.x / 2, at.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(at.x + delta.x, at.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
}

/**
 * How far a drawing's painted line is from where its points say it should be, in pixels.
 *
 * The line is painted with round caps and a nib of its own, so its painted box is half a nib bigger than the
 * points on every side; that is the paint and not a miss, and it is subtracted before the distance is said.
 */
export async function paintedStrokeMiss(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const camera = await getCamera(page);
  const points = await strokePoints(page, id);
  const stroke = await strokeOnPage(page, id);
  const nib = PEN_THICKNESS_WORLD[stroke.thickness] * camera.zoom;
  const onScreen = points.map((point) => worldToScreen(camera, point));
  const left = Math.min(...onScreen.map((point) => point.x));
  const top = Math.min(...onScreen.map((point) => point.y));
  const right = Math.max(...onScreen.map((point) => point.x));
  const bottom = Math.max(...onScreen.map((point) => point.y));
  const painted = await paintedStrokeBox(page, id);
  return {
    x: painted.x - (left - nib / 2),
    y: painted.y - (top - nib / 2),
    width: painted.width - (right - left + nib),
    height: painted.height - (bottom - top + nib),
  };
}

/** The distance a pointer may be from a drawing's line and still be answered, in this page's pixels. */
export function hitToleranceOnScreen(zoom: number): number {
  return STROKE_HIT_TOLERANCE_PX / zoom;
}

/** The six inks, in the order the panel shows them. */
export const PEN_INKS = Object.keys(PEN_COLORS) as (keyof typeof PEN_COLORS)[];

/** The ink a page paints a drawing with. */
export function inkOf(color: string): string {
  return PEN_COLORS[color as keyof typeof PEN_COLORS];
}

export { BOARD_AREA };
