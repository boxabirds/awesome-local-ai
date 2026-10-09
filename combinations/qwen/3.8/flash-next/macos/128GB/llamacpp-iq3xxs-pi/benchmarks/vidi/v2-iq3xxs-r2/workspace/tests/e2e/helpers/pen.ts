import { expect, type Page } from '@playwright/test';
import { settle } from './board';

/**
 * The Pen and its strokes in real browsers (story 11).
 *
 * Two readings, as the other suites do: this browser's document (`boardDoc()`), which is what
 * another person sees once a stroke has been released into it, and this browser's DOM, which is
 * what this person sees — including the one thing that never reaches anybody else, the line
 * being drawn under the pointer.
 *
 * A stroke is drawn as one SVG path with no `viewBox`, so a point on that path is a point on
 * the screen plus the corner of the box, which is how `strokeInkPoint` finds somewhere a click
 * can land on the ink rather than on the empty space a stroke's box is mostly made of.
 */

export const PEN_TOOL_LABEL = 'Pen (P)';

export interface PenPoint {
  readonly x: number;
  readonly y: number;
}

/** A stroke as one browser's document holds it. */
export interface StrokeRecord {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: string;
  readonly thickness: string;
  readonly points: number;
  readonly createdBy: string;
}

/* ---------------------------------------------------------------------------
 * The tool and its options.
 * ------------------------------------------------------------------------ */

export async function clickPenTool(page: Page): Promise<void> {
  await page.locator(`button[aria-label="${PEN_TOOL_LABEL}"]`).click();
  await settle(page);
}

/** The tool, by its shortcut: the PRD says `P`. */
export async function pressPenTool(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await settle(page);
}

export async function toolPressed(page: Page, testId: string): Promise<boolean> {
  return (await page.locator(`[data-testid="${testId}"]`).getAttribute('aria-pressed')) === 'true';
}

export async function penSurfaceVisible(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="pen-tool-surface"]').count()) === 1;
}

export async function clickPenColour(page: Page, colour: string): Promise<void> {
  await page.locator(`button[aria-label="${colour} pen"]`).click();
  await settle(page);
}

export async function clickPenThickness(page: Page, thickness: string): Promise<void> {
  const label = thickness[0].toUpperCase() + thickness.slice(1);
  await page.locator(`[data-testid="pen-toolbar"] button[aria-label="${label}"]`).click();
  await settle(page);
}

export async function penOptionPressed(page: Page, testId: string): Promise<boolean> {
  return (await page.locator(`[data-testid="${testId}"]`).getAttribute('aria-pressed')) === 'true';
}

/** The round cursor the pen carries, as it is painted: a CSS length each way. */
export async function penCursorSize(page: Page): Promise<number> {
  const size = await page.locator('[data-testid="pen-cursor"]').evaluate((element) => {
    const box = (element as HTMLElement).style.width;
    return Number.parseFloat(box);
  });
  return size;
}

/* ---------------------------------------------------------------------------
 * Drawing.
 * ------------------------------------------------------------------------ */

/**
 * Press and drag along a recorded path, in screen pixels, and let go.
 *
 * `steps` is the path itself, point by point — this is a hand, not a straightedge — so a test
 * that wants a fast sketch passes a thinned path rather than a smoothed one.
 */
export async function drawPenPath(page: Page, points: readonly PenPoint[]): Promise<void> {
  if (points.length < 2) throw new Error('a pen path needs at least two points');
  await page.mouse.move(Math.round(points[0].x), Math.round(points[0].y));
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(Math.round(point.x), Math.round(point.y));
  }
  await page.mouse.up();
  await settle(page);
}

/** The same, but pressing and holding so a test can look at the page mid-drag. */
export async function holdPenAlong(
  page: Page,
  points: readonly PenPoint[],
): Promise<void> {
  if (points.length < 2) throw new Error('a pen path needs at least two points');
  await page.mouse.move(Math.round(points[0].x), Math.round(points[0].y));
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(Math.round(point.x), Math.round(point.y));
  }
}

/** Every other point, to a budget: a fast sketch is still the same shape. */
export function thin<T>(points: readonly T[], every: number): T[] {
  return points.filter((_, index) => index % every === 0);
}

/* ---------------------------------------------------------------------------
 * The line being drawn, sampled once per animation frame.
 * ------------------------------------------------------------------------ */

declare global {
  interface Window {
    __vidi6PenSamples?: string[];
  }
}

/**
 * Start writing down, at every animation frame, the `d` of the line being drawn — or an empty
 * string for the frames where there is none.
 *
 * This is the only way to ask the question `pen.tool` asks: whether the preview is redrawn as
 * the pointer moves rather than once at the end. It is done in the page because the frames are
 * the page's, not the test's.
 */
export async function startPreviewSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__vidi6PenSamples = [];
    const tick = (): void => {
      const path = document.querySelector('[data-testid="pen-preview"]');
      window.__vidi6PenSamples?.push(path ? String(path.getAttribute('d') ?? '') : '');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function previewSamples(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6PenSamples ?? []);
}

/* ---------------------------------------------------------------------------
 * Strokes: the document and the screen.
 * ------------------------------------------------------------------------ */

export async function strokesOn(page: Page): Promise<StrokeRecord[]> {
  const strokes = await page.evaluate(() => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    return Object.entries(objects)
      .filter(([, value]) => String(value.type ?? '') === 'stroke')
      .map(([id, value]) => ({
        id,
        type: String(value.type),
        x: Number(value.x),
        y: Number(value.y),
        z: Number(value.z),
        width: Number(value.width),
        height: Number(value.height),
        baseWidth: Number(value.baseWidth),
        baseHeight: Number(value.baseHeight),
        color: String(value.color ?? ''),
        thickness: String(value.thickness ?? ''),
        points: Array.isArray(value.points) ? value.points.length / 2 : 0,
        createdBy: String(value.createdBy ?? ''),
      }));
  });
  return strokes.sort((a, b) => a.id.localeCompare(b.id));
}

export async function waitForStrokes(page: Page, count: number): Promise<StrokeRecord[]> {
  await expect
    .poll(async () => (await strokesOn(page)).length, { timeout: 15_000 })
    .toBe(count);
  return strokesOn(page);
}

export async function strokeIn(page: Page, id: string): Promise<StrokeRecord> {
  const stroke = (await strokesOn(page)).find((entry) => entry.id === id);
  if (!stroke) throw new Error(`no stroke with id ${id} on this board`);
  return stroke;
}

/** Draw a stroke with the tool and hand back what it made: one stroke, or more if it split. */
export async function drawStrokeOnBoard(
  page: Page,
  points: readonly PenPoint[],
): Promise<StrokeRecord[]> {
  const before = new Set((await strokesOn(page)).map((stroke) => stroke.id));
  await drawPenPath(page, points);
  const created = (await strokesOn(page)).filter((stroke) => !before.has(stroke.id));
  if (created.length === 0) throw new Error(`the Pen tool created no stroke at ${points[0].x},${points[0].y}`);
  return created;
}

/**
 * Somewhere on the ink of a stroke, in screen pixels: the middle of its path, which is
 * guaranteed to be a point the pointer can land on.
 */
export async function strokeInkPoint(page: Page, id: string): Promise<PenPoint> {
  const point = await page.evaluate((strokeId) => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="stroke-object"][data-note-id="${strokeId}"]`,
    );
    const path = element?.querySelector('[data-testid="stroke-line"]');
    const svg = element?.querySelector('svg');
    if (!element || !path || !svg) throw new Error(`stroke ${strokeId} is not drawn`);
    const svgPath = path as SVGPathElement;
    const box = svg.getBoundingClientRect();
    const at = svgPath.getPointAtLength(svgPath.getTotalLength() / 2);
    return { x: box.x + at.x, y: box.y + at.y };
  }, id);
  return point;
}

/** Click the ink of a stroke: it becomes this browser's selection. */
export async function selectStrokeOnBoard(page: Page, id: string): Promise<void> {
  const at = await strokeInkPoint(page, id);
  await page.mouse.click(Math.round(at.x), Math.round(at.y));
  await settle(page);
}

/** The stroke's box on screen, and the thickness its line is painted with. */
export async function strokePainting(page: Page, id: string): Promise<{
  width: number;
  height: number;
  strokeWidth: number;
  stroke: string;
  d: string;
}> {
  return page.evaluate((strokeId) => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="stroke-object"][data-note-id="${strokeId}"]`,
    );
    if (!element) throw new Error(`no stroke element for id ${strokeId}`);
    const line = element.querySelector('[data-testid="stroke-line"]');
    if (!line) throw new Error(`stroke ${strokeId} has no drawn line`);
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      strokeWidth: Number.parseFloat(line.getAttribute('stroke-width') ?? '0'),
      stroke: line.getAttribute('stroke') ?? '',
      d: line.getAttribute('d') ?? '',
    };
  }, id);
}

export async function selectedStrokeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="stroke-object"]'))
      .filter((element) => element.dataset.selected === 'true')
      .map((element) => element.dataset.noteId ?? ''),
  );
}
