// Pen helpers for the browser tests (story 11).
//
// Same rule as the shape helpers, and it matters more here: a stroke is stored in world units and
// drawn through the camera, so every point in these helpers is a *screen* point that is converted
// through the live board's own camera when a world number is wanted. World 0,0 sits in the middle
// of the window at 100%, where the board opens, so the numbers in the specs are the numbers on the
// screen — which is what makes "draw a loop and its box is that loop" a statement a reader can
// check.
//
// Two things are specific to this tool:
//
//  * A press while the pen is held belongs to the pen's layer, which covers the whole board. So a
//    stroke is drawn on that layer and a stroke is selected by clicking *the line* — a stroke's box
//    takes no presses, and Playwright would be clicking nothing (pen.select).
//  * A mouse event is dispatched and handled some time after `mouse.up()` returns, so everything
//    after a drag waits for the document to say so (`waitForNewStroke`) rather than reading the
//    document and hoping the gesture has happened yet.

import { expect, type Page } from '@playwright/test';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { Point } from '../../../src/shared/geometry';
import { strokePolyline, type StrokeSnap } from '../../../src/shared/objects/stroke';
import { screenOf, worldOf } from './shape';

/** The layer the pen is held in: it covers the board while the pen is the tool. */
export function penLayer(page: Page) {
  return page.getByTestId('pen-tool-layer');
}

/** The pen's own options: the inks and the nibs. */
export function penToolbar(page: Page) {
  return page.getByTestId('pen-toolbar');
}

/** Pick the pen up with its letter, and wait until the board says it is held. */
export async function holdPen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(penToolbar(page)).toBeVisible();
  await expect(penLayer(page)).toHaveAttribute('aria-hidden', 'true');
}

/** Which ink and nib this tab is holding, as its screen says. */
export async function penOptionsOn(
  page: Page,
): Promise<{ color: string | null; thickness: string | null }> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="pen-toolbar"]');
    const ink = bar?.querySelector('[data-pen-color][aria-pressed="true"]');
    const nib = bar?.querySelector('[data-pen-thickness][aria-pressed="true"]');
    return {
      color: ink?.getAttribute('data-pen-color') ?? null,
      thickness: nib?.getAttribute('data-pen-thickness') ?? null,
    };
  });
}

/** Choose the ink the next stroke will be drawn in. */
export async function choosePenInk(page: Page, color: PenColor): Promise<void> {
  await page.getByRole('button', { name: `${color} pen` }).click();
  await expect(
    page.getByRole('button', { name: `${color} pen` }),
  ).toHaveAttribute('aria-pressed', 'true');
}

/** Choose how thick the next stroke will be. */
export async function choosePenNib(
  page: Page,
  thickness: PenThickness,
): Promise<void> {
  const name = thickness.charAt(0).toUpperCase() + thickness.slice(1);
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('button', { name })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** The drawings on this board, as this client's model sees them. */
export function strokesOn(page: Page): Promise<readonly StrokeSnap[]> {
  return page.evaluate(() => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('board test handle missing');
    return api.strokes().map((s) => ({ ...s }));
  });
}

export async function strokeIdsOn(page: Page): Promise<string[]> {
  return (await strokesOn(page)).map((s) => s.id);
}

export async function strokeOf(page: Page, id: string): Promise<StrokeSnap> {
  const found = (await strokesOn(page)).find((s) => s.id === id);
  if (!found) throw new Error(`stroke ${id} is not on this board`);
  return found;
}

/** The path as drawn, in board units: the line the hit test and the ink are made of. */
export function strokeWorldLine(page: Page, id: string): Promise<Point[]> {
  return strokeOf(page, id).then((s) => [...strokePolyline(s)]);
}

/** The preview's path data, in screen pixels: the line being drawn right now. */
export function previewD(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const path = document.querySelector('[data-testid="pen-preview-path"]');
    return path ? path.getAttribute('d') : null;
  });
}

/** Whether this screen is in the middle of a press. */
export function penIsDrawing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-testid="pen-tool-layer"]');
    return layer?.getAttribute('data-pen-drawing') === 'true';
  });
}

/** The cursor the pen is holding: a round nib of the current thickness. */
export function penCursorOf(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-testid="pen-tool-layer"]')?.getAttribute('style') ?? '',
  );
}

/**
 * Press the pen down at a screen point. The press is on the tool's layer, which is what a real
 * pointer is on while the pen is held — over a note, over an arrow, anywhere.
 */
export async function beginStroke(page: Page, at: Point): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(penLayer(page)).toHaveAttribute('data-pen-drawing', 'true');
}

/** Carry the press through these screen points, the way a hand does. */
export async function moveStroke(
  page: Page,
  through: readonly Point[],
  steps = 2,
): Promise<void> {
  for (const at of through) await page.mouse.move(at.x, at.y, { steps });
}

/** Lift the pen. The stroke is written by the page a moment later. */
export async function endStroke(page: Page): Promise<void> {
  await page.mouse.up();
}

/**
 * Carry the press through the points one animation frame at a time, which is how a hand and a
 * compositor actually work together: the pointer reports, the browser paints, the hand goes on.
 */
export async function moveStrokePerFrame(
  page: Page,
  through: readonly Point[],
): Promise<void> {
  for (const at of through) {
    await page.mouse.move(at.x, at.y);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  }
}

/** The page side of the sampler below, as it is installed. */
interface FrameWindow {
  __vidi6PenFrames?: (string | null)[];
  __vidi6PenSampling?: boolean;
}

/**
 * Start watching the preview from inside the page, on its own animation frames.
 *
 * A test that read the preview between two Playwright calls would be reading it whenever the
 * browser got round to it, which proves nothing about frames. This counts the path the page itself
 * painted, once per frame, while the pointer is moving.
 */
export async function startPreviewSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as FrameWindow;
    w.__vidi6PenFrames = [];
    if (w.__vidi6PenSampling) return;
    w.__vidi6PenSampling = true;
    const tick = (): void => {
      if (!w.__vidi6PenSampling) return;
      const path = document.querySelector('[data-testid="pen-preview-path"]');
      w.__vidi6PenFrames?.push(path ? path.getAttribute('d') : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop watching and hand back what each frame was painted with, oldest first. */
export function stopPreviewSampler(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const w = window as unknown as FrameWindow;
    w.__vidi6PenSampling = false;
    return w.__vidi6PenFrames ?? [];
  });
}

/**
 * Draw a screen path from first point to last, and wait for the document to record it. Returns the
 * stroke that is new, and fails if the gesture wrote more than one: one press is one stroke, which
 * is the part of this story that a browser could plausibly get wrong.
 */
export async function drawStroke(
  page: Page,
  points: readonly Point[],
  steps = 3,
): Promise<StrokeSnap> {
  const before = await strokesOn(page);
  await beginStroke(page, points[0]!);
  await moveStroke(page, points.slice(1), steps);
  await endStroke(page);
  return waitForNewStroke(page, before);
}

/** The ink of a stroke as painted: the colour and the width the browser was told to draw with. */
export function strokeInkPaint(page: Page, id: string): Promise<Record<string, string | null>> {
  return page.evaluate((sid) => {
    const line = document.querySelector(`[data-testid="stroke-line-${sid}"]`);
    if (!line) throw new Error(`stroke ${sid} is not drawn`);
    const num = ['stroke', 'stroke-width', 'stroke-linecap', 'fill'];
    return Object.fromEntries(num.map((n) => [n, line.getAttribute(n)]));
  }, id);
}

/** The painted line's width on the screen, measured from the drawn path, not from the model. */
export function strokeWidthOnScreen(page: Page, id: string): Promise<number> {
  return page.evaluate((sid) => {
    const box = document.querySelector(`[data-testid="stroke-svg-${sid}"]`);
    const line = document.querySelector(`[data-testid="stroke-line-${sid}"]`);
    if (!box || !line) throw new Error(`stroke ${sid} is not drawn`);
    const svg = box.getBoundingClientRect().width;
    const viewBox = Number(
      (box.getAttribute('viewBox') ?? '').split(/\s+/)[2],
    );
    const nib = parseFloat(line.getAttribute('stroke-width') ?? '0');
    // The path is written in the box's own units, so what reaches the screen is the nib times the
    // box's drawn size over the box's declared size.
    return svg / viewBox * nib;
  }, id);
}

/**
 * A screen point that lies on the drawn line: the middle of the middle segment. A stroke's box is
 * not a hit target, so this is the only point a person — or a test — can press to select it
 * (pen.select).
 */
export async function strokeLinePoint(
  page: Page,
  id: string,
  where = 0.5,
): Promise<Point> {
  const line = await strokeWorldLine(page, id);
  const t = Math.min(1, Math.max(0, where));
  const segments = Math.max(1, line.length - 1);
  const i = Math.min(segments - 1, Math.floor(t * segments));
  const a = line[i] ?? line[0]!;
  const b = line[Math.min(line.length - 1, i + 1)]!;
  return screenOf(page, { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 });
}

/** Select a drawing the way a person does: click its line. */
export async function clickStrokeLine(page: Page, id: string): Promise<void> {
  const at = await strokeLinePoint(page, id);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId(`stroke-${id}`)).toHaveAttribute(
    'data-selected',
    'true',
  );
}

/** Whether this screen says the drawing is selected. */
export function strokeSelected(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sid) => {
    const el = document.querySelector(`[data-testid="stroke-${sid}"]`);
    if (!el) throw new Error(`stroke ${sid} is not drawn`);
    return el.getAttribute('data-selected') === 'true';
  }, id);
}

/** The box the drawing is painted in, in client pixels. */
export async function strokeScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(`stroke-${id}`).boundingBox();
  if (!box) throw new Error(`stroke ${id} is not drawn`);
  return box;
}

/** Press the line and drag the drawing along with it: story 7's move, on story 11's object. */
export async function dragStrokeBody(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const at = await strokeLinePoint(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 });
  await page.mouse.up();
}

/**
 * Wait for a gesture to have written its stroke, and hand back the stroke that is new.
 *
 * The release is dispatched before the document is written, so a test that read the document
 * straight after `mouse.up()` would be reading it mid-sentence.
 */
export async function waitForNewStroke(
  page: Page,
  before: readonly StrokeSnap[],
): Promise<StrokeSnap> {
  const ids = before.map((s) => s.id);
  await expect
    .poll(async () => (await strokeIdsOn(page)).some((id) => !ids.includes(id)), {
      message: 'the gesture never wrote a stroke',
    })
    .toBe(true);
  const after = await strokesOn(page);
  const fresh = after.filter((s) => !ids.includes(s.id));
  expect(fresh, 'one press writes one stroke').toHaveLength(1);
  return fresh[0]!;
}

/** Wait until this person's board no longer holds the drawing. */
export async function expectStrokeGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await strokeIdsOn(page)).includes(id), {
      message: `stroke ${id} is still on this board`,
    })
    .toBe(false);
  await expect(page.getByTestId(`stroke-${id}`)).toHaveCount(0);
}

/**
 * Draw a stroke through the model at screen points, for the tests that need a drawing to exist
 * and are not about drawing one. It goes through the same `createStroke` the tool calls, so it is
 * indistinguishable from a stroke that was drawn — including propagating to everyone else.
 */
export async function seedStrokeOnBoard(
  page: Page,
  points: readonly Point[],
  color?: PenColor,
  thickness?: PenThickness,
): Promise<string> {
  const world = await Promise.all(points.map((p) => worldOfScreen(page, p)));
  const id = await page.evaluate(
    ([pts, c, t]) => {
      const api = window.__vidi6TestBoard;
      if (!api) throw new Error('board test handle missing');
      return api.createStroke(pts, c, t);
    },
    [world, color, thickness] as [Point[], PenColor | undefined, PenThickness | undefined],
  );
  if (id === null) throw new Error('the model refused the path it was asked to draw');
  await expect(page.getByTestId(`stroke-${id}`)).toBeVisible();
  return id;
}

/** The world point a screen point falls on, through this board's live camera. */
export function worldOfScreen(page: Page, p: Point): Promise<Point> {
  return worldOf(page, p);
}

/**
 * The same conversion for a whole path, in one round trip: a test that measured a drawn path's
 * extent point by point would spend more time converting coordinates than drawing the path.
 */
export function worldAllOfScreen(page: Page, points: readonly Point[]): Promise<Point[]> {
  const screen = points.map((p) => ({ x: p.x, y: p.y }));
  return page.evaluate((pts) => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('board test hooks missing');
    const cam = hooks.getCamera();
    return pts.map((p) => ({
      x: p.x / cam.zoom + cam.x,
      y: p.y / cam.zoom + cam.y,
    }));
  }, screen);
}
