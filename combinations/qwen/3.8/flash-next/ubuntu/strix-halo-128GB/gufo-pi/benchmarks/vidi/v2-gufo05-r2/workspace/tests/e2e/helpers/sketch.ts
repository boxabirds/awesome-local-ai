/**
 * Helpers for story 11's end-to-end tests: sketches drawn with a real pointer.
 *
 * As in story 10, two things are read for every claim — what the shared document holds
 * and what this browser actually drew — because a stroke is the first object whose drawn
 * form is a curve rather than a box, and the two can only be compared through the box the
 * ink was measured into. Screen boxes are measured in pixels and converted back through
 * the element's own box, so they stay true at any zoom.
 *
 * The preview has a helper of its own because it cannot be tested by looking once: the
 * claim is that the line follows the pointer *on every frame*, so the sampler runs inside
 * the page on `requestAnimationFrame` while the mouse is being moved, and the frames it
 * collected are read back afterwards.
 */

import { expect, type Page } from '@playwright/test';

import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { StrokeSnapshot } from '../../../src/shared/objects/stroke';
import { expectNoPendingCameraFrame, type Pixel } from './board';

export interface DrawnStroke {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The path this browser was told to draw. */
  readonly d: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly linecap: string;
  readonly linejoin: string;
  readonly fill: string;
}

/**
 * The board surface's top-left, in viewport pixels.
 *
 * Board units are measured from there, not from the browser window, so any test that puts
 * a recorded path on the screen has to shift it by this. With the camera at its default it
 * is the window's own corner; measuring it means the test does not have to assume so.
 */
export async function surfaceOrigin(page: Page): Promise<Pixel> {
  const box = await page.locator('[data-testid="board-viewport"]').boundingBox();
  if (!box) throw new Error('the board surface has no box on this screen');
  return { x: box.x, y: box.y };
}

/**
 * Board units as this browser draws them, for a camera at `{x: 0, y: 0, zoom: 1}`.
 *
 * A fixture path is a path on the board; the mouse is moved in window pixels, and the two
 * differ by wherever the surface sits.
 */
export async function toScreen(page: Page, points: readonly Pixel[]): Promise<Pixel[]> {
  const origin = await surfaceOrigin(page);
  return points.map((point) => ({ x: origin.x + point.x, y: origin.y + point.y }));
}

async function readStrokes(page: Page): Promise<StrokeSnapshot[]> {
  const list = await page.evaluate(() => {
    const w = window as unknown as { __vidi6?: { getStrokes?: () => unknown[] } };
    if (!w.__vidi6?.getStrokes) throw new Error('getStrokes missing: e2e needs a test build');
    return w.__vidi6.getStrokes();
  });
  return list as StrokeSnapshot[];
}

export function getStrokes(page: Page): Promise<StrokeSnapshot[]> {
  return readStrokes(page);
}

/**
 * A stroke placed through the app's own test hook, from a recorded pointer path in board
 * units — so a test has a big sketch to select without spending ten seconds dragging one.
 */
export async function seedStrokeOnBoard(
  page: Page,
  points: readonly Pixel[],
  color?: PenColor,
  thickness?: PenThickness,
): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const w = window as unknown as {
        __vidi6?: {
          seedStroke?(
            points: readonly Pixel[],
            color?: PenColor,
            thickness?: PenThickness,
          ): string;
        };
      };
      if (!w.__vidi6?.seedStroke) throw new Error('seedStroke missing: e2e needs a test build');
      return w.__vidi6.seedStroke(args.points, args.color, args.thickness);
    },
    { points, color, thickness },
  );
  if (!id) throw new Error('the seeded stroke was refused by the model');
  await expect(page.locator(`[data-testid="stroke-${id}"]`)).toBeVisible();
  return id;
}

/** How a sketch is drawn on this screen: its box, and the path inside it. */
export async function drawnStroke(page: Page, id: string): Promise<DrawnStroke> {
  const drawn = await page.evaluate((strokeId) => {
    const holder = document.querySelector<HTMLElement>(`[data-object-id="${strokeId}"]`);
    const svg = document.querySelector<SVGSVGElement>(`[data-testid="stroke-${strokeId}"]`);
    const ink = document.querySelector<SVGPathElement>(
      `[data-testid="stroke-${strokeId}"] [data-testid="stroke-line"]`,
    );
    if (!holder || !svg || !ink) return null;
    const box = holder.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      svgWidth: Number(svg.getAttribute('width')),
      d: ink.getAttribute('d') ?? '',
      stroke: ink.getAttribute('stroke') ?? '',
      strokeWidth: Number(ink.getAttribute('stroke-width')),
      linecap: ink.getAttribute('stroke-linecap') ?? '',
      linejoin: ink.getAttribute('stroke-linejoin') ?? '',
      fill: ink.getAttribute('fill') ?? '',
    };
  }, id);
  if (!drawn) throw new Error(`stroke ${id} is not drawn on this screen`);
  if (drawn.d === '' || drawn.d.includes('NaN')) {
    throw new Error(`stroke ${id} is drawn with no path, or a broken one: "${drawn.d}"`);
  }
  return { id, ...drawn };
}

export async function pickPenTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  await expect(page.getByTestId('pen-tool-layer')).toBeVisible();
}

export async function choosePenColor(page: Page, color: PenColor): Promise<void> {
  await page.getByTestId(`pen-color-${color}`).click();
  await expect(page.getByTestId(`pen-color-${color}`)).toHaveAttribute('aria-pressed', 'true');
}

export async function choosePenThickness(page: Page, thickness: PenThickness): Promise<void> {
  await page.getByTestId(`pen-thickness-${thickness}`).click();
  await expect(page.getByTestId(`pen-thickness-${thickness}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

/** Where the pen's ring cursor is, and how big it is, in screen pixels. */
export async function penCursorState(page: Page): Promise<{
  width: number;
  height: number;
  borderColor: string;
  visible: boolean;
}> {
  const state = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      borderColor: getComputedStyle(el).borderTopColor,
      visible: getComputedStyle(el).visibility === 'visible',
    };
  });
  if (!state) throw new Error('the pen has no cursor ring on this screen');
  return state;
}

/** The path being drawn right now, or null when the pen is not in the middle of one. */
export function penPreview(page: Page) {
  return page.getByTestId('pen-preview-path');
}

/**
 * Start counting animation frames inside the page, recording the preview path each one.
 *
 * The claim is about frames, so the sampler has to be on the page's side of the wire:
 * Playwright's own round trips are far slower than a frame and would see one static
 * picture after another.
 */
export async function startPreviewSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __previewFrames?: (string | null)[]; __sampling?: boolean };
    w.__previewFrames = [];
    w.__sampling = true;
    const tick = () => {
      const state = window as unknown as { __previewFrames?: (string | null)[]; __sampling?: boolean };
      if (!state.__sampling) return;
      const path = document.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');
      state.__previewFrames?.push(path?.getAttribute('d') ?? null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop sampling and hand back what the frames held. */
export async function stopPreviewSampler(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __previewFrames?: (string | null)[]; __sampling?: boolean };
    w.__sampling = false;
    return w.__previewFrames ?? [];
  });
}

/**
 * Draw a pointer path with a real mouse, in screen pixels.
 *
 * Every point is its own move, because the line the tool records *is* the pointer path;
 * `steps` would interpolate inside the browser and hide a tool that only sampled the
 * ends.
 */
export async function drawPathByPointer(
  page: Page,
  points: readonly Pixel[],
  options: { hold?: boolean } = {},
): Promise<void> {
  if (points.length < 2) throw new Error('a path needs at least two points');
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await expectNoPendingCameraFrame(page);
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  if (!options.hold) {
    await expectNoPendingCameraFrame(page);
    await page.mouse.up();
    await expectNoPendingCameraFrame(page);
  }
}

/** Release whatever the pointer is holding. */
export async function releasePointer(page: Page): Promise<void> {
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}

/** A press on the drawn line itself, at a given fraction along it. */
export async function clickStrokeLine(
  page: Page,
  id: string,
  at: number,
): Promise<void> {
  const point = await pointOnStrokeLine(page, id, at);
  await page.mouse.click(point.x, point.y);
}

/**
 * A screen point on a sketch's line, `at` of the way along it, found by asking the path.
 *
 * A curve is not a straight line between two known ends, and the test must press the ink
 * rather than its bounding box — which is the whole rule about how a sketch is selected.
 */
export async function pointOnStrokeLine(page: Page, id: string, at = 0.5): Promise<Pixel> {
  const point = await page.evaluate(
    ([strokeId, fraction]) => {
      const svg = document.querySelector<SVGSVGElement>(`[data-testid="stroke-${strokeId}"]`);
      const ink = document.querySelector<SVGPathElement>(
        `[data-testid="stroke-${strokeId}"] [data-testid="stroke-line"]`,
      );
      if (!svg || !ink) return null;
      const box = svg.getBoundingClientRect();
      const view = svg.viewBox.baseVal;
      const sx = view.width > 0 ? box.width / view.width : 1;
      const sy = view.height > 0 ? box.height / view.height : 1;
      const length = ink.getTotalLength();
      const local = ink.getPointAtLength(length * fraction);
      return { x: box.left + local.x * sx, y: box.top + local.y * sy };
    },
    [id, at] as [string, number],
  );
  if (!point) throw new Error(`stroke ${id} is not drawn on this screen`);
  return point;
}

/** The selection handles are on the screen, which is how a test says "this is selected". */
export async function expectSelected(page: Page): Promise<void> {
  await expect(page.locator('[data-resize-handle="se"]')).toBeVisible({ timeout: 5_000 });
}

export async function expectNothingSelected(page: Page): Promise<void> {
  await expect(page.locator('[data-resize-handle]')).toHaveCount(0);
}
