import { expect, type Page } from '@playwright/test';
import { cameraOf, screenOf, type ScreenPoint } from './shapes';
import type { Point } from '../../../src/shared/geometry';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import { PEN_COLOR_LABELS, PEN_THICKNESS_LABELS } from '../../../src/shared/config';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

/**
 * The Pen tool and the drawings it leaves, as a page draws and reads them.
 *
 * Two rules run through everything here, and they are the two the story turns on.
 *
 * The first is that a measurement is taken from what the page drew, never from what
 * the test hoped for: a stroke's box is the box the drawing itself reports, in board
 * units (`data-box-*`, the way an arrow reports its two ends), and a point on its
 * line is a point the painted path says lies on it. A test that clicked the middle of
 * a drawing's box would be a test that clicked a drawing's empty middle, which is the
 * one place a drawing is not.
 *
 * The second is that the way to click a drawing is to click its line: every click
 * here goes through `strokeLinePoint`, which asks the drawn path where it is. That is
 * also the assertion — the corridor the paint offers and the corridor the model
 * answers are the same corridor, so a click taken to the drawn line is a click the
 * board must agree is on the drawing.
 */

export const penButton = (page: Page) => page.getByRole('button', { name: 'Pen (P)', exact: true });
export const penToolbar = (page: Page) => page.getByRole('toolbar', { name: 'Pen toolbar' });
export const penColorButton = (page: Page, color: PenColor) =>
  page.getByRole('button', { name: `${PEN_COLOR_LABELS[color]} pen`, exact: true });
export const penThicknessButton = (page: Page, thickness: PenThickness) =>
  page.getByRole('button', { name: PEN_THICKNESS_LABELS[thickness], exact: true });

export const strokeLocator = (page: Page, id: string) => page.locator(`[data-stroke-id="${id}"]`);
export const strokeLine = (page: Page, id: string) =>
  strokeLocator(page, id).locator('[data-testid="stroke-line"]');
/** The stroke in flight. Present while the pointer is down and drawing, and nothing else. */
export const previewLocator = (page: Page) => page.getByTestId('stroke-preview');
export const previewPath = (page: Page) => previewLocator(page).locator('path');

/** Every drawing on the board, in the order they were made. */
export async function strokeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-stroke-id]')).map((el) => el.getAttribute('data-stroke-id')!),
  );
}

export async function strokeCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-stroke-id]').length);
}

/** Wait for the board to be drawing exactly this many drawings. */
export async function waitForStrokeCount(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(async () => (await strokeIds(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return strokeIds(page);
}

/** The box a drawing is stored in, in board units, as the drawing reports it. */
export async function strokeWorldBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return strokeLocator(page, id).evaluate((el) => ({
    x: Number(el.getAttribute('data-box-x')),
    y: Number(el.getAttribute('data-box-y')),
    width: Number(el.getAttribute('data-box-width')),
    height: Number(el.getAttribute('data-box-height')),
  }));
}

/** The pen a drawing was made with, as stored: the two numbers a swatch cannot change. */
export async function strokePen(page: Page, id: string): Promise<{ color: string; thickness: string }> {
  return strokeLocator(page, id).evaluate((el) => ({
    color: el.getAttribute('data-color') ?? '',
    thickness: el.getAttribute('data-thickness') ?? '',
  }));
}

/** How many points the drawing is stored with. */
export async function strokePointCount(page: Page, id: string): Promise<number> {
  const raw = await strokeLocator(page, id).getAttribute('data-points');
  return raw === null ? -1 : Number(raw);
}

/** The pen's width as the drawing stores it, in board units. */
export async function strokeWidthInBoardUnits(page: Page, id: string): Promise<number> {
  return strokeLine(page, id).evaluate((el) => Number(el.getAttribute('stroke-width')));
}

/**
 * How wide the line is painted, in screen pixels: the board units of the pen times the
 * way the board is magnified, measured through the path's own way onto the screen.
 *
 * This is measured rather than assumed because it is the assertion the story asks for:
 * a drawing keeps its proportions and its pen, and the pen keeps its width relative to
 * the board it was drawn on. A line is stored four units wide and painted eight pixels
 * at 200 % — and the corridor round it is the one thing that does not follow.
 */
export async function strokeWidthOnScreen(page: Page, id: string): Promise<number> {
  return strokeLine(page, id).evaluate((el) => {
    const path = el as SVGPathElement;
    const ctm = path.getScreenCTM();
    if (ctm === null) throw new Error('a drawing has no way onto the screen');
    return Number(path.getAttribute('stroke-width')) * ctm.a;
  });
}

/**
 * How wide the invisible corridor the drawing offers the pointer is painted, in screen
 * pixels. It is stored in board units divided by the zoom, so that it comes out the
 * same number of pixels at every zoom — which is the story 9 lesson, and is worth
 * measuring at two different zooms to know it held.
 */
export async function strokeCorridorOnScreen(page: Page, id: string): Promise<number> {
  return strokeLocator(page, id)
    .locator('[data-testid="stroke-hit"]')
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const ctm = path.getScreenCTM();
      if (ctm === null) throw new Error('a drawing has no way onto the screen');
      return Number(path.getAttribute('stroke-width')) * ctm.a;
    });
}

export async function strokeIsSelected(page: Page, id: string): Promise<boolean> {
  return strokeLocator(page, id).evaluate((el) => el.getAttribute('data-selected') === 'true');
}

/** The drawings this page has selected, in the order it drew them. */
export async function selectedStrokeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-stroke-id]'))
      .filter((el) => el.getAttribute('data-selected') === 'true')
      .map((el) => el.getAttribute('data-stroke-id')!),
  );
}

/**
 * A point on the drawing's own line, on the screen: halfway along the painted path.
 *
 * This is where a click has to land to be a click on the drawing, and it is asked of
 * the path the browser painted rather than worked out from the stored points — the
 * drawing's box is not where the drawing is, and the middle of a circle's box is the
 * middle of nothing.
 */
export async function strokeLinePoint(page: Page, id: string, fraction = 0.5): Promise<ScreenPoint> {
  return strokeLine(page, id).evaluate((el, at) => {
    const path = el as SVGPathElement;
    const here = path.getPointAtLength(path.getTotalLength() * at);
    // The path's own way onto the screen, applied by hand: the matrix is a plain six
    // numbers, and a helper that needed more of it than that would be a helper that
    // could not be used in every browser this suite runs in.
    const ctm = path.getScreenCTM();
    if (ctm === null) throw new Error('a drawing has no way onto the screen');
    return {
      x: ctm.a * here.x + ctm.c * here.y + ctm.e,
      y: ctm.b * here.x + ctm.d * here.y + ctm.f,
    };
  }, fraction);
}

/** The drawn line's own rectangle on the screen, in screen pixels. */
export async function strokeScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await strokeLine(page, id).boundingBox();
  if (box === null) throw new Error(`drawing ${id} is not painted`);
  return box;
}

/** Press the Pen tool and wait for the board to say it is the tool in use. */
export async function armPenTool(page: Page): Promise<void> {
  if ((await penButton(page).getAttribute('aria-pressed')) !== 'true') await penButton(page).click();
  await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Choose the pen: a colour and a width, for this stroke and every one after it. */
export async function choosePen(
  page: Page,
  pen: { color?: PenColor; thickness?: PenThickness },
): Promise<void> {
  if (pen.color !== undefined) {
    await penColorButton(page, pen.color).click();
    await expect(penColorButton(page, pen.color)).toHaveAttribute('aria-pressed', 'true');
  }
  if (pen.thickness !== undefined) {
    await penThicknessButton(page, pen.thickness).click();
    await expect(penThicknessButton(page, pen.thickness)).toHaveAttribute('aria-pressed', 'true');
  }
}

/** One animation frame, so a drag can be watched frame by frame. */
export function nextFrame(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
}

/**
 * Start a stroke on the board and move the pointer along the path given, in screen
 * pixels, one animation frame per step, without letting go.
 *
 * The frames are the point: a drag that was over before the first one came round
 * would prove nothing about a preview that is supposed to be redrawn every frame.
 */
export async function dragThePen(page: Page, path: readonly ScreenPoint[]): Promise<void> {
  await page.mouse.move(path[0]!.x, path[0]!.y);
  await page.mouse.down();
  for (const point of path.slice(1)) {
    await page.mouse.move(point.x, point.y);
    await nextFrame(page);
  }
}

/** Draw a stroke along a path in screen pixels, and return what it made. */
export async function drawStroke(page: Page, path: readonly ScreenPoint[]): Promise<string> {
  const before = new Set(await strokeIds(page));
  await dragThePen(page, path);
  const last = path[path.length - 1]!;
  await page.mouse.up();
  await expect
    .poll(async () => (await strokeIds(page)).filter((id) => !before.has(id)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(1);
  return (await strokeIds(page)).find((id) => !before.has(id)) as string;
}

/** Draw a stroke through points given in board units, at the zoom the page is at. */
export async function drawStrokeInBoardUnits(page: Page, points: readonly Point[]): Promise<string> {
  const path: ScreenPoint[] = [];
  for (const point of points) path.push(await screenOf(page, point));
  return drawStroke(page, path);
}

/** Click a drawing on its line, and wait for the board to have it selected. */
export async function clickStroke(page: Page, id: string): Promise<void> {
  const at = await strokeLinePoint(page, id);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(() => strokeIsSelected(page, id), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
}

/** A drawing's state, in the form two pages can be compared on: its box, its pen,
 *  and how many points it is stored with. Two pages that draw the same drawing
 *  disagree on none of it. */
export async function strokeState(page: Page, id: string): Promise<string> {
  return strokeLocator(page, id).evaluate((el) =>
    [
      el.getAttribute('data-stroke-id'),
      el.getAttribute('data-box-x'),
      el.getAttribute('data-box-y'),
      el.getAttribute('data-box-width'),
      el.getAttribute('data-box-height'),
      el.getAttribute('data-color'),
      el.getAttribute('data-thickness'),
      el.getAttribute('data-points'),
      el.getAttribute('data-selected'),
    ].join('|'),
  );
}

/** Start watching every drawing this page draws, so the moment one arrives can be told. */
export async function watchStrokes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __strokes: Record<string, { at: number }[]>;
      __sawStroke(id: string, notBefore: number): boolean;
    };
    w.__strokes = {};
    const record = (): void => {
      const at = Date.now();
      for (const el of Array.from(document.querySelectorAll('[data-stroke-id]'))) {
        const id = el.getAttribute('data-stroke-id')!;
        const seen = (w.__strokes[id] ??= []);
        if (seen.length === 0) seen.push({ at });
      }
    };
    const world = document.querySelector('[data-testid="world-layer"]') ?? document.body;
    new MutationObserver(record).observe(world, { childList: true, subtree: true, attributes: true });
    record();
    w.__sawStroke = (id: string, notBefore: number): boolean =>
      (w.__strokes[id] ?? []).some((entry) => entry.at >= notBefore);
  });
}

/** Has this page drawn this drawing at or after the moment the other person let go? */
export function sawStroke(page: Page, id: string, notBefore: number): Promise<boolean> {
  return page.evaluate(
    (asked) =>
      (window as never as { __sawStroke(id: string, notBefore: number): boolean }).__sawStroke(
        asked.id,
        asked.notBefore,
      ),
    { id, notBefore },
  );
}

/**
 * The frames of a stroke in flight, sampled by the page itself once per animation
 * frame while the pointer is moving.
 *
 * It is the page that samples, not the test process, because what is being measured
 * is how often the picture changed *in the page*: a test that polled from node would
 * be measuring how fast a socket is, and would report a preview that never moved.
 */
export async function startSamplingPreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __previewFrames?: string[];
      __sampling?: boolean;
    };
    w.__previewFrames = [];
    w.__sampling = true;
    const grab = (): void => {
      const path = document.querySelector('[data-testid="stroke-preview"] path');
      w.__previewFrames!.push(path === null ? '' : (path.getAttribute('d') ?? ''));
      if (w.__sampling) requestAnimationFrame(grab);
    };
    requestAnimationFrame(grab);
  });
}

/** Stop sampling and hand back the `d` of every frame, oldest first ('' = no preview). */
export async function stopSamplingPreview(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __previewFrames?: string[]; __sampling?: boolean };
    w.__sampling = false;
    return w.__previewFrames ?? [];
  });
}

/** How many frames the preview was drawn on, and how many different ones it was. */
export async function previewFrames(page: Page): Promise<{ frames: number; distinct: number }> {
  const frames = await stopSamplingPreview(page);
  const drawn = frames.filter((frame) => frame !== '');
  return { frames: drawn.length, distinct: new Set(drawn).size };
}
