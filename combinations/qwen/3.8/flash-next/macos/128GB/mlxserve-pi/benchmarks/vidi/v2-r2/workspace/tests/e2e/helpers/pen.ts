// Helpers for story 11's e2e tests: strokes drawn freehand with the Pen, the preview
// that is painted while the pen is down, and the colour and weight chosen for the next
// line. Content is read out of the live document through `window.__vidi6.snapshot()`
// (test build only), and the pointer is driven through board points, so a test says
// which line it drew rather than which pixels it waved at.
//
// The fixtures in tests/fixtures/pen-paths.ts are written in BOARD units for the camera
// `setCamera(page, { x: 0, y: 0, zoom: 1 })` puts up, at which board units and window
// pixels are the same numbers - so a fixture point can be used as a screen point too,
// but everything here converts through the camera the board is holding anyway.

import { expect, type Locator, type Page } from '@playwright/test';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { StrokeSnapshot } from '../../../src/shared/objects/stroke';
import { scaledPoints } from '../../../src/shared/objects/stroke';
import type { Point } from './board';
import { readCamera } from './board';
import { connectionState, waitForSyncReady } from './live';

export type { PenColor, PenThickness, Point };

/** A stroke reduced to the fields that must agree across every client. */
export interface StrokeContent {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
  z: number;
  /** How many points the stored line holds (a pair of numbers is one point). */
  points: number;
}

interface Hooks {
  __vidi6: { snapshot(): Record<string, unknown>[] };
}

/** Every object on the board, as the test hook answers it. */
function snapshotOf(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as unknown as Hooks).__vidi6.snapshot() as Record<string, unknown>[]);
}

/** The strokes on the board, in document (and therefore painting) order. */
export async function strokes(page: Page): Promise<StrokeContent[]> {
  const all = await snapshotOf(page);
  return all.filter((o) => o['type'] === 'stroke').map((o) => {
    const s = o as unknown as StrokeSnapshot;
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      baseWidth: s.baseWidth,
      baseHeight: s.baseHeight,
      color: s.color,
      thickness: s.thickness,
      z: s.z,
      points: s.points.length / 2,
    };
  });
}

export async function strokeCount(page: Page): Promise<number> {
  return (await strokes(page)).length;
}

export async function strokeAt(page: Page, index: number): Promise<StrokeContent> {
  const list = await strokes(page);
  const stroke = list[index];
  if (stroke === undefined) throw new Error(`stroke ${index} is not on the board`);
  return stroke;
}

export async function strokeById(page: Page, id: string): Promise<StrokeContent> {
  const list = await strokes(page);
  const stroke = list.find((s) => s.id === id);
  if (stroke === undefined) throw new Error(`stroke ${id} is not on the board`);
  return stroke;
}

/**
 * The stored line of one stroke, in board units, scaled through the stroke's own box -
 * the same read the board does when it works out what a click hit.
 */
export async function strokePath(page: Page, index: number): Promise<Point[]> {
  const all = await snapshotOf(page);
  const stroke = all.filter((o) => o['type'] === 'stroke')[index] as unknown as StrokeSnapshot | undefined;
  if (stroke === undefined) throw new Error(`stroke ${index} is not on the board`);
  return scaledPoints(stroke).map((p) => ({ x: p.x, y: p.y }));
}

const sameJson = (pages: Page[], read: (page: Page) => Promise<unknown>): Promise<boolean> =>
  Promise.all(pages.map(read)).then((all) => {
    const first = JSON.stringify(all[0]);
    return all.every((c) => JSON.stringify(c) === first);
  });

/** True once every page holds the same strokes, lines, boxes, colours and weights. */
export function strokesMatch(pages: Page[]): Promise<boolean> {
  return sameJson(pages, strokes);
}

export async function waitForStrokesMatch(pages: Page[], timeout = 15_000): Promise<void> {
  await expect
    .poll(() => strokesMatch(pages), { timeout, message: 'the strokes to converge' })
    .toBe(true);
}

/**
 * How long it took `pages` to agree on the strokes, in milliseconds - for a test that
 * reports a latency against a budget rather than failing on it.
 */
export async function timeToStrokesMatch(pages: Page[], timeout = 30_000): Promise<number> {
  const started = Date.now();
  await waitForStrokesMatch(pages, timeout);
  return Date.now() - started;
}

// ---------------------------------------------------------------------------
// the tool and the objects, as locators
// ---------------------------------------------------------------------------

export function penToolLayer(page: Page): Locator {
  return page.getByTestId('pen-tool-layer');
}
export function penToolButton(page: Page): Locator {
  return page.getByTestId('tool-pen');
}
export function penPreview(page: Page): Locator {
  return page.getByTestId('pen-preview');
}
export function penPreviewPath(page: Page): Locator {
  return page.getByTestId('pen-preview-path');
}
export function penCursor(page: Page): Locator {
  return page.getByTestId('pen-cursor');
}
export function penToolbar(page: Page): Locator {
  return page.getByTestId('pen-toolbar');
}
export function penColorButton(page: Page, color: PenColor): Locator {
  return page.getByTestId(`pen-color-${color}`);
}
export function penThicknessButton(page: Page, thickness: PenThickness): Locator {
  return page.getByTestId(`pen-thickness-${thickness}`);
}
export function strokeObjects(page: Page): Locator {
  return page.locator('[data-testid="stroke-object"]');
}
/** The painted line itself - the ink, not the fat invisible target behind it. */
export function strokeInk(page: Page, index: number): Locator {
  return strokeObjects(page).nth(index).locator('[data-testid="stroke-ink"]');
}
/** The invisible fat stroke target that decides where a click hits the line. */
export function strokeHitTarget(page: Page, index: number): Locator {
  return strokeObjects(page).nth(index).locator('[data-testid="stroke-hit"]');
}
/** The selection halo, only painted while the stroke is the selection. */
export function strokeHalo(page: Page, index: number): Locator {
  return strokeObjects(page).nth(index).locator('[data-testid="stroke-halo"]');
}

/** The weight's width as the line is painted, in board units at zoom 1. */
export async function paintedThickness(page: Page, index = 0): Promise<number> {
  const width = await strokeInk(page, index).getAttribute('stroke-width');
  if (width === null) throw new Error(`stroke ${index} has no painted width`);
  return Number(width);
}

/** The ink the line is painted in, as the browser was told to paint it. */
export async function paintedInkColor(page: Page, index = 0): Promise<string | null> {
  return strokeInk(page, index).getAttribute('stroke');
}

/**
 * The stroke's painted box, in window pixels. Read from the element the board positioned,
 * because that is the thing a person sees in a place.
 */
export async function strokeScreenBox(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await strokeObjects(page).nth(index).boundingBox();
  if (box === null) throw new Error(`stroke ${index} is not rendered`);
  return box;
}

// ---------------------------------------------------------------------------
// the tool, held
// ---------------------------------------------------------------------------

/**
 * Hold the Pen tool with its keyboard letter, and set the colour and weight when the
 * test names them. The layer that catches the pointer is there once the tool is held.
 */
export async function holdPenTool(
  page: Page,
  options: { color?: PenColor; thickness?: PenThickness } = {},
): Promise<void> {
  await page.keyboard.press('p');
  await expect(penToolLayer(page)).toHaveCount(1);
  await pickPenColor(page, options.color);
  await pickPenThickness(page, options.thickness);
}

/** Choose the colour for the next line, by mouse. No-op when it is already chosen. */
export async function pickPenColor(page: Page, color?: PenColor): Promise<void> {
  if (color === undefined) return;
  await expect(penToolbar(page)).toHaveCount(1);
  if ((await penColorButton(page, color).getAttribute('aria-pressed')) !== 'true') {
    await penColorButton(page, color).click();
  }
  await expect(penColorButton(page, color)).toHaveAttribute('aria-pressed', 'true');
}

/** Choose the weight for the next line, by mouse. */
export async function pickPenThickness(page: Page, thickness?: PenThickness): Promise<void> {
  if (thickness === undefined) return;
  if ((await penThicknessButton(page, thickness).getAttribute('aria-pressed')) !== 'true') {
    await penThicknessButton(page, thickness).click();
  }
  await expect(penThicknessButton(page, thickness)).toHaveAttribute('aria-pressed', 'true');
}

/** Put the keyboard focus on a colour button: the panel is reachable by keyboard. */
export async function focusPenColorButton(page: Page, color: PenColor): Promise<void> {
  await penColorButton(page, color).evaluate((el: HTMLElement) => el.focus());
}

/** Let go of the Pen tool (its button, so the layer goes with it). */
export async function dropPenTool(page: Page): Promise<void> {
  await penToolButton(page).click();
  await expect(penToolLayer(page)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// placing the pointer by where on the board it means
// ---------------------------------------------------------------------------

/** Where a board point is on the screen, for the camera the board is holding. */
export async function screenOf(page: Page, world: Point): Promise<Point> {
  const camera = await readCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** The same, for a whole path, with the camera read once. */
export async function screenOfPath(page: Page, path: readonly Point[]): Promise<Point[]> {
  const camera = await readCamera(page);
  return path.map((p) => ({ x: (p.x - camera.x) * camera.zoom, y: (p.y - camera.y) * camera.zoom }));
}

/**
 * A point on the painted line, as a screen point: `getPointAtLength` asks the browser's
 * own path geometry, which is the truth about where the ink is. That is what clicking
 * "on the line" means, and it does not assume the curve passes through the stored
 * points, which a quadratic path does not.
 */
export async function strokeLineScreenPoint(page: Page, index: number, fraction = 0.5): Promise<Point> {
  const user = await strokeInk(page, index).evaluate((el, f) => {
    const path = el as unknown as SVGPathElement;
    const at = path.getPointAtLength(path.getTotalLength() * f);
    return { x: at.x, y: at.y };
  }, fraction);
  return screenOf(page, user);
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

/** Press the Pen's layer at a board point, and leave the pointer down. */
export async function pressPenAt(page: Page, at: Point): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
}

/**
 * Carry the down pen through board points, in order.
 *
 * The path is walked in batches: one `mouse.move` with `steps` is one trip to the
 * browser and leaves that many real move events behind it, which is what a hand does
 * anyway - hundreds of points in a few hundred milliseconds. A path of hundreds of
 * points driven one event per round trip would take longer than the test is allowed.
 * `paceMs` puts a wait between the batches, for a test that wants to watch the frames.
 */
export async function dragPenThrough(
  page: Page,
  path: readonly Point[],
  options: { batch?: number; paceMs?: number } = {},
): Promise<void> {
  const batch = Math.max(1, options.batch ?? 10);
  const screens = await screenOfPath(page, path);
  let i = 0;
  while (i < screens.length) {
    const to = screens[i]!;
    if (i + batch >= screens.length) {
      await page.mouse.move(to.x, to.y);
      i = screens.length;
    } else {
      const far = screens[i + batch]!;
      await page.mouse.move(far.x, far.y, { steps: batch });
      i += batch;
    }
    if (options.paceMs !== undefined) await page.waitForTimeout(options.paceMs);
  }
}

/** Lift the pen. */
export async function releasePen(page: Page): Promise<void> {
  await page.mouse.up();
}

/**
 * Draw one whole stroke with the Pen: hold the tool, carry the pen through the path,
 * lift it, and wait for the stroke to be on the board. Returns the stroke as stored.
 */
export async function drawStroke(
  page: Page,
  path: readonly Point[],
  options: { color?: PenColor; thickness?: PenThickness } = {},
): Promise<StrokeContent> {
  const before = await strokeCount(page);
  await holdPenTool(page, options);
  await pressPenAt(page, path[0]!);
  await dragPenThrough(page, path.slice(1));
  await releasePen(page);
  await expect
    .poll(() => strokeCount(page), { message: 'the stroke to be on the board' })
    .toBeGreaterThan(before);
  return strokeAt(page, before);
}

/**
 * A board that has been opened again: wait until it is joined to the others, so what
 * it holds is the board and not the empty document it started the load with. Reading a
 * count before this would be reading a board that has not arrived yet.
 */
export async function waitForBoardLoaded(page: Page): Promise<void> {
  await waitForSyncReady(page);
  await expect
    .poll(() => connectionState(page), { timeout: 30_000, message: 'the board to be connected' })
    .toBe('connected');
}

// ---------------------------------------------------------------------------
// the preview, sampled on animation frames
// ---------------------------------------------------------------------------

export interface PreviewSample {
  /** The line drawn so far, or null when nothing was being drawn that frame. */
  d: string | null;
  /** The frame's timestamp. */
  t: number;
}

/**
 * Start sampling the Pen's preview line once per animation frame, in the page. The
 * sampler runs until the page goes away; a test reads the samples when it is done.
 */
export async function startPreviewSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __penPreviewSamples?: PreviewSample[] };
    w.__penPreviewSamples = [];
    const tick = (time: number): void => {
      const el = document.querySelector('[data-testid="pen-preview-path"]');
      w.__penPreviewSamples!.push({ d: el === null ? null : el.getAttribute('d'), t: time });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function previewSamples(page: Page): Promise<PreviewSample[]> {
  return page.evaluate(
    () => (window as unknown as { __penPreviewSamples?: PreviewSample[] }).__penPreviewSamples ?? [],
  );
}

/** How many pairs of consecutive frames both drew a line, and drew a different one. */
export function previewFrameChanges(samples: readonly PreviewSample[]): number {
  let changes = 0;
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1]!;
    const after = samples[i]!;
    if (before.d !== null && after.d !== null && before.d !== after.d) changes++;
  }
  return changes;
}

/** How many frames were sampled while a line was being drawn. */
export function previewFrameCount(samples: readonly PreviewSample[]): number {
  return samples.filter((s) => s.d !== null).length;
}
