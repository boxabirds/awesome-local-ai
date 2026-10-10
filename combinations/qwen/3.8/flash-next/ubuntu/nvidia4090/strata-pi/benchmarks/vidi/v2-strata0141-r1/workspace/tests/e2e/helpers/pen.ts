import { expect, type Locator, type Page } from '@playwright/test';
import type { StrokeSnap } from '../../../src/shared/objects/stroke';
import { worldPoints } from '../../../src/shared/objects/stroke';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  type PenColor,
  type PenThickness,
} from '../../../src/shared/config';
import { getCamera, type ScreenPoint } from './board';

/**
 * Story 11 pen helpers (`pen.tool`, `pen.options`, `stroke.object`).
 *
 * As with shapes and arrows, two views of the same stroke are used on purpose:
 * the model snapshot, which is camera independent and says what the board agreed
 * on, and the drawn `<svg>` - its box, its `d`, its `stroke-width` - which says
 * what a person actually sees at their zoom. A test that only read the model could
 * pass a stroke that was never painted.
 *
 * Drags are replayed from paths recorded in `tests/fixtures/pen-paths.ts`, so a
 * pointer moves the way a hand moved: one real input event per recorded point.
 */

interface StrokeHooks {
  strokes(): StrokeSnap[];
}

/** A box in screen pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The strokes this page's model holds, topmost last. */
export async function getStrokes(page: Page): Promise<StrokeSnap[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: StrokeHooks }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.strokes();
  });
}

export async function strokeOf(page: Page, id: string): Promise<StrokeSnap> {
  const strokes = await getStrokes(page);
  const found = strokes.find((stroke) => stroke.id === id);
  if (!found) {
    throw new Error(`stroke ${id} is not on the board`);
  }
  return found;
}

/** Wait until the board holds exactly `count` strokes. */
export async function waitForStrokeCount(page: Page, count: number): Promise<StrokeSnap[]> {
  await expect
    .poll(async () => (await getStrokes(page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never showed ${count} strokes`,
    })
    .toBe(count);
  return getStrokes(page);
}

/** Wait until a stroke with this id is on the page (true) or gone (false). */
export async function waitForStroke(page: Page, id: string, present = true): Promise<void> {
  await expect
    .poll(
      async () => (await getStrokes(page)).some((stroke) => stroke.id === id) === present,
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `stroke ${id} never became ${present ? 'visible' : 'gone'}`,
      },
    )
    .toBe(true);
}

/** How long a stroke this page just made takes to appear on another page. */
export async function measureStrokeConvergence(
  from: Page,
  to: Page,
  change: () => Promise<void>,
): Promise<{ ms: number; stroke: StrokeSnap }> {
  const ids = (await getStrokes(from)).map((stroke) => stroke.id);
  const started = Date.now();
  await change();
  await expect
    .poll(
      async () => (await getStrokes(to)).some((stroke) => !ids.includes(stroke.id)),
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the finished stroke never reached the other board',
      },
    )
    .toBe(true);
  const ms = Date.now() - started;
  const stroke = (await getStrokes(to)).find((entry) => !ids.includes(entry.id));
  if (!stroke) {
    throw new Error('the new stroke is not on the other board');
  }
  return { ms, stroke };
}

/** Compare strokes as one canonical list, so two pages can be called the same board. */
const strokeData = (strokes: readonly StrokeSnap[]): string =>
  JSON.stringify(
    strokes.map((stroke) => ({
      id: stroke.id,
      x: Math.round(stroke.x),
      y: Math.round(stroke.y),
      width: Math.round(stroke.width),
      height: Math.round(stroke.height),
      color: stroke.color,
      thickness: stroke.thickness,
      points: stroke.points.length,
      z: stroke.z,
    })),
  );

/** Wait until every page agrees on the strokes, and return them. */
export async function waitForSameStrokes(
  pages: readonly Page[],
): Promise<readonly StrokeSnap[]> {
  let first = '[]';
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(async (page) => strokeData(await getStrokes(page))));
        first = all[0] ?? '[]';
        return all.every((entry) => entry === first);
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the boards never agreed on the strokes' },
    )
    .toBe(true);
  return getStrokes(pages[0] as Page);
}

/* -------------------------------------------------------------------------- */
/* The pen, in hand                                                           */
/* -------------------------------------------------------------------------- */

/** Hold the Pen tool (`pen.tool`), by shortcut or by button. */
export async function pressPenTool(page: Page, via: 'p' | 'toolbar' = 'p'): Promise<void> {
  if (via === 'p') {
    await page.keyboard.press('p');
  } else {
    await page.getByRole('button', { name: 'Pen (P)' }).click();
  }
  await page.waitForTimeout(40);
  await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'pen');
}

/** The pen's option toolbar, only there while the pen is in hand. */
export function penToolbar(page: Page): Locator {
  return page.getByTestId('pen-toolbar');
}

export async function penOptionsVisible(page: Page): Promise<boolean> {
  return (await penToolbar(page).count()) > 0;
}

export async function clickPenColor(page: Page, color: PenColor): Promise<void> {
  await page.getByTestId(`pen-color-${color}`).click();
  await page.waitForTimeout(40);
}

export async function clickPenThickness(page: Page, thickness: PenThickness): Promise<void> {
  await page.getByTestId(`pen-thickness-${thickness}`).click();
  await page.waitForTimeout(40);
}

export async function penColorPressed(page: Page, color: PenColor): Promise<boolean> {
  return (await page.getByTestId(`pen-color-${color}`).getAttribute('aria-pressed')) === 'true';
}

export async function penThicknessPressed(page: Page, thickness: PenThickness): Promise<boolean> {
  return (
    (await page.getByTestId(`pen-thickness-${thickness}`).getAttribute('aria-pressed')) === 'true'
  );
}

/** The pen tip drawn on the board (`pen.cursor`). */
export function penCursor(page: Page): Locator {
  return page.getByTestId('pen-cursor');
}

/** The stroke this page is drawing, which nobody else can see (`pen.share`). */
export function penPreviewPath(page: Page): Locator {
  return page.getByTestId('pen-preview-path');
}

export async function penPreviewPresent(page: Page): Promise<boolean> {
  return (await penPreviewPath(page).count()) > 0;
}

/** World point -> screen point, using the camera this page is really on. */
export async function penScreenOf(page: Page, world: ScreenPoint): Promise<ScreenPoint> {
  const camera = await getCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/**
 * Wait for `frames` animation frames, in the page.
 *
 * A drag step measured in frames rather than in milliseconds: on a fast machine it
 * costs almost nothing, on a loaded one it waits for the frame the pen's redraw
 * needs. That is what makes the frame assertions in TC-17 about frames and not
 * about how busy this machine happens to be.
 */
export async function penFrames(page: Page, frames = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let index = 0; index < count; index += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }, frames);
}

/**
 * Drag the pen through a recorded path, one pointer event per point.
 *
 * `framesPerPoint` gives each point its own animation frames (see `penFrames`);
 * `pauseMs` is the older fixed wait. With neither, this is simply a fast drag.
 */
export async function penDragThrough(
  page: Page,
  points: ScreenPoint[],
  options: { pauseMs?: number; framesPerPoint?: number } = {},
): Promise<void> {
  const first = points[0];
  if (!first) {
    throw new Error('a pen drag needs at least one point');
  }
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    await page.mouse.move(point.x, point.y);
    if (options.framesPerPoint) {
      await penFrames(page, options.framesPerPoint);
    } else if (options.pauseMs) {
      await page.waitForTimeout(options.pauseMs);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/* -------------------------------------------------------------------------- */
/* Sampling the preview on consecutive animation frames (TC-17)               */
/* -------------------------------------------------------------------------- */

/**
 * Start reading the preview path on **every animation frame**, in the page.
 *
 * The sample list is what the test then argues about: not "the preview existed at
 * some point during the drag" but "the line changed again and again, once per
 * displayed frame" (`pen.smooth`, TC-17).
 */
export async function startPreviewSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      __penPreviewSamples?: (string | null)[];
      __penSampling?: boolean;
    };
    target.__penPreviewSamples = [];
    target.__penSampling = true;
    const tick = (): void => {
      if (target.__penSampling !== true) {
        return;
      }
      const path = document.querySelector('[data-testid="pen-preview-path"]');
      target.__penPreviewSamples?.push(path ? path.getAttribute('d') : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop sampling and return what every frame showed. */
export async function stopPreviewSampling(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const target = window as unknown as {
      __penPreviewSamples?: (string | null)[];
      __penSampling?: boolean;
    };
    target.__penSampling = false;
    return target.__penPreviewSamples ?? [];
  });
}

/* -------------------------------------------------------------------------- */
/* A stroke on the screen                                                     */
/* -------------------------------------------------------------------------- */

export function strokeCard(page: Page, id: string): Locator {
  return page.locator(`[data-testid="stroke-object-${id}"]`);
}

/** The visible line of a rendered stroke. */
export function strokeLine(page: Page, id: string): Locator {
  return page.locator(`[data-testid="stroke-line-${id}"]`);
}

/** The invisible band a click on a stroke's line lands on. */
export function strokeHitArea(page: Page, id: string): Locator {
  return page.locator(`[data-testid="stroke-hit-${id}"]`);
}

export async function strokeAttribute(
  page: Page,
  id: string,
  name: string,
  which: 'card' | 'line' | 'hit' = 'card',
): Promise<string | null> {
  const locator =
    which === 'card'
      ? strokeCard(page, id)
      : which === 'line'
        ? strokeLine(page, id)
        : strokeHitArea(page, id);
  return locator.getAttribute(name);
}

/** The stroke as the browser drew it: its box on screen, its path, its ink. */
export interface DrawnStroke {
  box: Rect;
  d: string;
  strokeWidth: number;
  stroke: string;
  strokeLinecap: string;
  strokeLinejoin: string;
  fill: string;
  hitWidth: number;
}

export async function drawnStroke(page: Page, id: string): Promise<DrawnStroke> {
  const box = await strokeCard(page, id).boundingBox();
  if (!box) {
    throw new Error(`stroke ${id} has no bounding box (is it on screen?)`);
  }
  const line = await strokeLine(page, id).evaluate((el) => {
    const style = getComputedStyle(el as HTMLElement);
    return {
      d: el.getAttribute('d') ?? '',
      strokeWidth: Number.parseFloat(el.getAttribute('stroke-width') ?? '0'),
      stroke: style.stroke,
      strokeLinecap: style.strokeLinecap,
      strokeLinejoin: style.strokeLinejoin,
      fill: style.fill,
    };
  });
  const hitWidth = Number(
    await strokeHitArea(page, id).evaluate((el) => el.getAttribute('stroke-width') ?? '0'),
  );
  return { box, ...line, hitWidth };
}

/**
 * A screen point that is **on** a stroke's line: the middle of its longest recorded
 * segment, converted with this page's camera.
 *
 * This is how a test clicks a drawing - not the middle of its box, which for a
 * drawing is usually empty (`stroke.hit`, TC-16), but a point the line really
 * passes through.
 */
export async function strokeLinePoint(page: Page, id: string): Promise<ScreenPoint> {
  const stroke = await strokeOf(page, id);
  const points = worldPoints(stroke);
  if (points.length === 1) {
    return penScreenOf(page, points[0]!);
  }
  let best = { from: points[0]!, to: points[1]!, length: 0 };
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > best.length) {
      best = { from, to, length };
    }
  }
  return penScreenOf(page, {
    x: (best.from.x + best.to.x) / 2,
    y: (best.from.y + best.to.y) / 2,
  });
}

/** Press, drag and release a stroke by a point its line passes through. */
export async function dragStrokeBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const grab = await strokeLinePoint(page, id);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 8 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

export async function waitForStrokeSelected(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await strokeAttribute(page, id, 'data-selected')) === 'true', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `stroke ${id} was never selected`,
    })
    .toBe(true);
}
