/**
 * Strokes in a real browser (`tests/e2e/pen.spec.ts`).
 *
 * The unit file proves the arithmetic; the jsdom file proves the tool. What is left for a
 * real browser is the three things a simulation cannot supply: a pointer that is captured
 * by the surface and stays captured across a fast drag, a line that is painted on the
 * screen where the mouse went, and a change that arrives in somebody else's window. So
 * these helpers move a real mouse, and then measure two currencies - where the ink was
 * *drawn* (CSS pixels, from the rendered path) and where it was *stored* (board units, from
 * the document) - and leave it to the tests to say whether they agree, always through the
 * page's live camera.
 *
 * Two things are deliberately missing:
 *
 * - No camera numbers written down. The board opens centred on the origin and the tests
 *   draw near the middle of the window, but every comparison between a screen point and a
 *   board point goes through `screenOf`/`worldOf`.
 * - No waiting on a clock. A stroke either arrives in the other person's document or it
 *   does not; `measureChange` in the spec times how long it took and prints it, against the
 *   design's budget, which is a report rather than an assertion.
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { cameraState, waitForRender } from './board.js';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../../../src/client/canvas/camera.js';
import type { ObjectSnapshot } from '../../../src/shared/board-model.js';
import type { StrokeSnap } from '../../../src/shared/objects/stroke.js';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config.js';

/** A box on the screen, in CSS pixels. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------- the elements */

export const penToolButton = (page: Page): Locator => page.getByTestId('pen-tool-button');
/** The sheet the pen draws on: only present while the pen is in hand. */
export const penSurface = (page: Page): Locator => page.getByTestId('pen-tool-surface');
/** The line being drawn, which is this tab's alone. */
export const penPreview = (page: Page): Locator => page.getByTestId('pen-preview');
/** The ring that says where the pen is and how wide its ink is. */
export const penCursor = (page: Page): Locator => page.getByTestId('pen-cursor');
/** The pen's option bar: inks and widths. */
export const penToolbar = (page: Page): Locator => page.getByTestId('pen-toolbar');
export const penColorButton = (page: Page, color: string): Locator =>
  page.locator(`[data-testid="pen-color-button"][data-color="${color}"]`);
export const penThicknessButton = (page: Page, thickness: string): Locator =>
  page.locator(`[data-testid="pen-thickness-button"][data-thickness="${thickness}"]`);
export const strokeElements = (page: Page): Locator => page.getByTestId('stroke-object');
export const strokeOf = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="stroke-object"][data-object-id="${id}"]`);
/** The ink itself: the drawn path, which is what a person's question is about. */
export const strokeLine = (page: Page, id: string): Locator =>
  strokeOf(page, id).locator('[data-testid="stroke-line"]');
/** The invisible line a pointer is answered on, which is as wide as the click tolerance. */
export const strokeHit = (page: Page, id: string): Locator =>
  strokeOf(page, id).locator('[data-testid="stroke-hit"]');

/* -------------------------------------------------------------------- the document */

/**
 * The objects of this page's document, read where they are kept. The snapshot the app
 * renders from is not reachable from outside, and rebuilding it here would be a second
 * implementation of the reading; `getNotes` is `objectSnapshot`, so the test is told the
 * same thing the pixels were told.
 */
async function docObjects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => {
    const hooks = window.__vidi6Board;
    if (hooks === undefined || hooks === null) {
      throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    }
    return [...hooks.getNotes()];
  });
}

/** Every drawn stroke, in drawing order. */
export async function docStrokes(page: Page): Promise<StrokeSnap[]> {
  return (await docObjects(page)).filter((object): object is StrokeSnap => object.type === 'stroke');
}

export async function strokeAt(page: Page, index: number): Promise<StrokeSnap> {
  const strokes = await docStrokes(page);
  const stroke = strokes[index];
  if (stroke === undefined) throw new Error(`no stroke at position ${index} of ${strokes.length}`);
  return stroke;
}

export async function strokeById(page: Page, id: string): Promise<StrokeSnap> {
  const stroke = (await docStrokes(page)).find((candidate) => candidate.id === id);
  if (stroke === undefined) throw new Error(`no stroke with id ${id}`);
  return stroke;
}

/**
 * Wait for the strokes to be in the document *and* on the screen. A change that arrived and
 * was not drawn is a change the person did not see, so both halves are waited for; the
 * timeout is the design's eventual one, because a stroke that reaches a colleague is a
 * change across a room.
 */
export async function waitForStrokeCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => docStrokes(page).then((strokes) => strokes.length), {
      message: `expected ${count} strokes in the document`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(count);
  await expect(strokeElements(page)).toHaveCount(count);
}

/* ------------------------------------------------------------------ the screen space */

export async function camera(page: Page): Promise<Camera> {
  return cameraState(page);
}

export async function screenOf(page: Page, point: Point): Promise<Point> {
  return worldToScreen(await cameraState(page), point);
}

export async function worldOf(page: Page, point: Point): Promise<Point> {
  return screenToWorld(await cameraState(page), point);
}

/** The box a stroke is drawn in - the stored box times the zoom, as the browser laid it out. */
export async function strokeScreenBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await strokeOf(page, id).boundingBox();
  if (box === null) throw new Error(`stroke ${id} is in the document but not drawn`);
  return box;
}

export async function strokeScreenCentre(page: Page, id: string): Promise<Point> {
  const box = await strokeScreenBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where the ink actually is on the screen, in CSS pixels: the rendered path's own box.
 *
 * This is the measurement the story turns on. The stored box is where the drawing *says*
 * it is and includes the padding the pen adds; this is where the painted line reaches, and
 * it is the only way to see whether a stroke was drawn where the mouse went rather than
 * merely stored near it.
 */
export async function strokeInkBox(page: Page, id: string): Promise<ScreenBox> {
  return strokeLine(page, id).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  });
}

/**
 * How many path commands the drawn line holds.
 *
 * `smoothPath` writes one `M`, one `Q` for every interior point of the trail and one `L`
 * to its last point, so the count is a fact about the trail rather than about the screen:
 * a stroke whose path holds three commands is a straight line, whatever the document says
 * it holds. The number is in the path's own space (board units), which is why the count is
 * read as an attribute and never as a pixel measurement.
 */
export async function strokeInkCommands(page: Page, id: string): Promise<number> {
  return strokeLine(page, id).evaluate((element) => {
    const d = element.getAttribute('d') ?? '';
    return (d.match(/[MQCL]/gu) ?? []).length;
  });
}

/** The ink's own width and colour as painted, in CSS pixels and a CSS colour. */
export async function strokeInkStyle(page: Page, id: string): Promise<{ width: number; stroke: string }> {
  const ink = await strokeLine(page, id).evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { width: Number.parseFloat(style.strokeWidth ?? '0'), stroke: style.stroke };
  });
  return { width: ink.width, stroke: toHex(ink.stroke) };
}

/**
 * The same colour in the spelling the test file has it in.
 *
 * A stylesheet says `#8E24AA`; a browser says `rgb(142, 36, 170)`. Both are the ink, and a
 * comparison between the two spellings is not a fact about the drawing - so the rgb() a
 * browser reports is turned back into the hex it came from, and the assertion is about
 * whether the purple arrived rather than about how a browser prints one.
 */
function toHex(color: string): string {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/u.exec(color);
  if (rgb === null) return color.toLowerCase();
  const [, red, green, blue] = rgb;
  return (
    '#' +
    [red, green, blue]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** How wide the clickable line is, in CSS pixels: the tolerance, on the screen. */
export async function strokeHitWidth(page: Page, id: string): Promise<number> {
  return strokeHit(page, id).evaluate((element) => {
    return Number.parseFloat(window.getComputedStyle(element).strokeWidth ?? '0');
  });
}

/* --------------------------------------------------------------------- the gestures */

/**
 * A mouse drag through a recorded path, one point per mouse event.
 *
 * No interpolation, on purpose. `steps` would put the pointer on a straight line between two
 * recorded points and never take it along the curve between them, so a test that measured
 * what was drawn after a stepped drag would be measuring the chord: the leftmost point of a
 * circle can sit entirely between two steps, and the drawing would come back a few pixels
 * narrower with nothing wrong in the drawing tool. Sent point by point, the browser is free
 * to merge the events into one frame - and the pen keeps the merged samples, which is what
 * `getCoalescedEvents` is for and what the component test asserts.
 */
async function mouseThrough(page: Page, points: readonly Point[], steps = 1): Promise<void> {
  const first = points[0];
  if (first === undefined) throw new Error('a drag needs somewhere to start');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps });
  }
  await page.mouse.up();
  await waitForRender(page);
}

/** Take the pen in hand: the button is pressed and the board is the pen's. */
export async function enterPenTool(page: Page): Promise<void> {
  await penToolButton(page).click();
  await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(penSurface(page)).toHaveCount(1);
  await expect(penToolbar(page)).toHaveCount(1);
}

/** Put the pen away with Escape, which is the other half of its own promise. */
export async function putPenAway(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(penSurface(page)).toHaveCount(0);
}

/** The pen stays in hand after a stroke: the button is still the pressed one. */
export async function expectPenStillInHand(page: Page): Promise<void> {
  await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** The pen's letter, which is the quickest way to hold it and has its own test in jsdom. */
export async function pressPenLetter(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Choose an ink or a width from the option bar, and wait for the board to agree. */
export async function choosePenColor(page: Page, color: string): Promise<void> {
  await penColorButton(page, color).click();
  await expect(penColorButton(page, color)).toHaveAttribute('aria-pressed', 'true');
}

export async function choosePenThickness(page: Page, thickness: string): Promise<void> {
  await penThicknessButton(page, thickness).click();
  await expect(penThicknessButton(page, thickness)).toHaveAttribute('aria-pressed', 'true');
}

/** Which ink and width the option bar says are chosen. */
export async function pressedPenOptions(page: Page): Promise<{ color: string | null; thickness: string | null }> {
  const pressed = await page.evaluate(() => {
    const color = document.querySelector('[data-testid="pen-color-button"][aria-pressed="true"]');
    const width = document.querySelector('[data-testid="pen-thickness-button"][aria-pressed="true"]');
    return {
      color: color?.getAttribute('data-color') ?? null,
      thickness: width?.getAttribute('data-thickness') ?? null,
    };
  });
  return pressed;
}

/**
 * Draw a stroke by dragging the pen through `points`, and hand back the stroke that
 * appeared. The pen is still in hand afterwards - which is what the wait is for: the tool
 * that made the drawing does not put itself away, so the only honest completion of the
 * gesture is the stroke itself arriving.
 */
export async function drawStroke(page: Page, points: readonly Point[], steps = 1): Promise<StrokeSnap> {
  const before = (await docStrokes(page)).length;
  await mouseThrough(page, points, steps);
  await waitForStrokeCount(page, before + 1);
  return await strokeAt(page, before);
}

/** Draw a stroke without taking the pen up first, for a test that is already holding it. */
export async function drawStrokeInHand(page: Page, points: readonly Point[], steps = 1): Promise<StrokeSnap> {
  const before = (await docStrokes(page)).length;
  await mouseThrough(page, points, steps);
  await waitForStrokeCount(page, before + 1);
  return await strokeAt(page, before);
}

/**
 * A loop, as screen points: the path a hand makes when it goes round and comes back near
 * where it started. The start and the end are not the same point, because a drawn loop that
 * closed exactly would be a fixture rather than a drawing.
 *
 * `wander` is how far the hand strays from the circle, as a share of the radius, and it is not
 * decoration in a test. A wobble whose wavelength is a few points long is rounded away by the
 * curve a stroke is painted with, so the line settles a couple of pixels inside the path the
 * mouse took - which is a fact about drawing a curve through points and about no zoom in
 * particular. A test that measures the board asks for `wander = 0`; a test that measures the
 * hand leaves the wobble in, which is why it is the default.
 */
export function loopPath(centre: Point, radius: number, samples = 26, wander = 0.06): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2 - Math.PI / 2;
    const wobble = 1 + wander * Math.sin(index * 2.1);
    points.push({
      x: Math.round(centre.x + Math.cos(angle) * radius * wobble),
      y: Math.round(centre.y + Math.sin(angle) * radius * wobble),
    });
  }
  return points;
}

/** A zigzag across a span, as screen points: the shape of a signature or an underline. */
export function zigzagPath(from: Point, width: number, height: number, peaks = 5): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= peaks * 2; index += 1) {
    points.push({
      x: Math.round(from.x + (width * index) / (peaks * 2)),
      y: Math.round(from.y + (index % 2 === 0 ? 0 : height)),
    });
  }
  return points;
}

/**
 * Press where a stroke is drawn, on the line itself: what a person does to select a
 * drawing. The point is taken from the *first* stored point of the trail, in board units,
 * and converted by this page's live camera - so the click is on the ink rather than
 * somewhere the ink was described.
 */
export async function pressStrokeLine(page: Page, id: string, which = 0): Promise<void> {
  const at = await strokePointOnScreen(page, id, which);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await waitForRender(page);
}

/**
 * Where a point of the drawing is on the screen right now, as the browser paints it.
 *
 * The `index` counts points of the stored trail, but the position is taken from the painted
 * line at the same share of its own length - measured with `getPointAtLength` and turned into
 * window coordinates by the element's own `getScreenCTM`. The distinction matters and cost a
 * test its patience: a stroke is drawn as a curve *through* its points, so the corner of a
 * sharp zigzag is not where the corner is painted, and a click aimed at the stored number can
 * land several pixels off a line that is six pixels wide. Aiming at the ink is what a person
 * does, and it is what the hit test is a promise about.
 */
export async function strokePointOnScreen(page: Page, id: string, index = 0): Promise<Point> {
  const count = (await strokeById(page, id)).points.length / 2;
  const fraction = count > 1 ? Math.min(Math.max(index / (count - 1), 0), 1) : 0;
  return page.evaluate(
    ({ strokeId, share }) => {
      const line = document.querySelector<SVGPathElement>(
        `[data-testid="stroke-object"][data-object-id="${strokeId}"] [data-testid="stroke-line"]`,
      );
      if (line === null) throw new Error(`stroke ${strokeId} is not drawn on this screen`);
      const at = line.getPointAtLength(line.getTotalLength() * share);
      // The browser knows how its own user space reaches the window: `getScreenCTM` is the
      // matrix of the element's coordinates into client pixels, board transform included.
      // Nothing here has to know the camera, the zoom or the box to place a point on a line.
      const ctm = line.getScreenCTM();
      if (ctm === null) throw new Error(`stroke ${strokeId} has no screen matrix`);
      const on = new DOMPoint(at.x, at.y).matrixTransform(ctm);
      return { x: on.x, y: on.y };
    },
    { strokeId: id, share: fraction },
  );
}

/** Which objects the board says are selected, whatever kind they are. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="sticky-note"][data-selected="true"], ' +
          '[data-testid="text-object"][data-selected="true"], ' +
          '[data-testid="shape-object"][data-selected="true"], ' +
          '[data-testid="connector-object"][data-selected="true"], ' +
          '[data-testid="stroke-object"][data-selected="true"]',
      ),
    ).map((element) => element.dataset.objectId ?? element.dataset.noteId ?? ''),
  );
}

/** How many resize handles the selection is offering. */
export async function handleCount(page: Page): Promise<number> {
  return page.locator('[data-testid="resize-handle"]').count();
}

/** The stored trail of a stroke, as board points, read from this page's document. */
export async function strokeTrail(page: Page, id: string): Promise<Point[]> {
  const stroke = await strokeById(page, id);
  const points: Point[] = [];
  for (let index = 0; index * 2 + 1 < stroke.points.length; index += 1) {
    points.push({ x: stroke.points[index * 2] ?? 0, y: stroke.points[index * 2 + 1] ?? 0 });
  }
  return points;
}

/** The drawn line's own `d`, as the component wrote it. */
export async function strokeInkPath(page: Page, id: string): Promise<string> {
  return (await strokeLine(page, id).getAttribute('d')) ?? '';
}

/**
 * The box the trail occupies *inside* its own box, in board units: what a resize scales.
 * Compared with the object's stored size, this is the question "did the drawing keep its
 * shape when the box changed?"
 */
export async function strokeTrailBox(page: Page, id: string): Promise<ScreenBox> {
  const trail = await strokeTrail(page, id);
  if (trail.length === 0) throw new Error(`stroke ${id} holds no trail`);
  const xs = trail.map((point) => point.x);
  const ys = trail.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
