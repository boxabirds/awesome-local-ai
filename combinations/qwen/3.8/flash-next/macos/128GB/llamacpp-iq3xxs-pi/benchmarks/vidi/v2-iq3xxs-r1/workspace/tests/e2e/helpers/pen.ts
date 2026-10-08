import { expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { scaledPoints, type StrokeSnap } from '../../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { SeedStroke } from '../../../src/client/canvas/testHooks';
import { markerCenter, type Box } from './board';

/**
 * Story 11 browser helpers.
 *
 * A stroke exists twice: as points in the shared document, and as one painted SVG path
 * on each screen. Keeping both in step is the whole story, so nearly every helper here
 * returns either the document's answer (`strokeSnapshots`) or the page's
 * (`strokePath`, `strokeScreenBox`) and the tests compare them.
 */

// --- The document's side -----------------------------------------------------

export function strokeSnapshots(page: Page): Promise<readonly StrokeSnap[]> {
  return page.evaluate(() => window.__vidi6!.getStrokes());
}

export async function strokeById(page: Page, id: string): Promise<StrokeSnap | undefined> {
  return (await strokeSnapshots(page)).find((stroke) => stroke.id === id);
}

/** Wait until this screen shows `count` strokes, and hand them back. */
export async function waitForStrokes(page: Page, count: number): Promise<readonly StrokeSnap[]> {
  await expect
    .poll(async () => (await strokeSnapshots(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return strokeSnapshots(page);
}

/** Ask the board for a drawing of its own, as if it had been saved with it on it. */
export async function seedStrokesOnBoard(page: Page, specs: readonly SeedStroke[]): Promise<string[]> {
  const ids = await page.evaluate((s) => window.__vidi6!.seedStrokes(s), [...specs]);
  await waitForStrokes(page, ids.length);
  return ids;
}

/** A sticky note, so a pen stroke can be drawn over something that must not move. */
export async function seedNoteOnBoard(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const [id] = await page.evaluate((spec) => window.__vidi6!.seedNotes([spec]), {
    ...rect,
    text: 'Do not move me',
  });
  await expect
    .poll(async () => (await page.evaluate(() => window.__vidi6!.getSnapshot())).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(1);
  return id!;
}

export function noteSnapshots(page: Page): Promise<readonly { id: string; x: number; y: number }[]> {
  return page.evaluate(() => window.__vidi6!.getSnapshot());
}

// --- The screen's side -------------------------------------------------------

/** The element the board painted for a stroke, by document id. */
export function strokeEl(page: Page, id: string) {
  return page.locator(`[data-stroke-id="${id}"]`);
}

export async function strokeScreenBox(page: Page, id: string): Promise<Box & { width: number; height: number }> {
  const box = await strokeEl(page, id).boundingBox();
  if (!box) throw new Error(`stroke ${id} is not painted on screen`);
  return box;
}

/** The `d` of the path this screen drew for a stroke — its line, as painted. */
export function strokePath(page: Page, id: string): Promise<string | null> {
  return page.evaluate((strokeId) => {
    const path = document.querySelector(`[data-stroke-id="${strokeId}"] [data-testid="stroke-line"]`);
    return path ? path.getAttribute('d') : null;
  }, id);
}

export function strokePathWidth(page: Page, id: string): Promise<string | null> {
  return page.evaluate((strokeId) => {
    const path = document.querySelector(`[data-stroke-id="${strokeId}"] [data-testid="stroke-line"]`);
    return path ? path.getAttribute('stroke-width') : null;
  }, id);
}

/** How many strokes this screen has painted at all. */
export function paintedStrokeCount(page: Page): Promise<number> {
  return page.locator('[data-stroke-id]').count();
}

/**
 * Start watching the preview once per animation frame, in the page itself. A stroke
 * is redrawn at most per frame, so the frames are the clock this is measured against:
 * what changed, and how often, between the first pointer move and the release.
 */
export async function startPreviewSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __previewSamples?: (string | null)[]; __previewSampling?: boolean };
    w.__previewSamples = [];
    w.__previewSampling = true;
    const tick = (): void => {
      if (!w.__previewSampling) return;
      const path = document.querySelector('[data-testid="pen-preview"]');
      w.__previewSamples!.push(path ? path.getAttribute('d') : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The frames the sampler saw, in order, with the last `d` each frame held. */
export async function readPreviewSamples(page: Page): Promise<(string | null)[]> {
  const samples = await page.evaluate(() => {
    const w = window as unknown as { __previewSamples?: (string | null)[]; __previewSampling?: boolean };
    w.__previewSampling = false;
    const out = w.__previewSamples ?? [];
    w.__previewSamples = undefined;
    return out;
  });
  if (samples.length === 0) throw new Error('the frame sampler never ran');
  return samples;
}

/** The line the pen is drawing right now, in this screen's own pixels. */
export function previewPath(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const path = document.querySelector('[data-testid="pen-preview"]');
    return path ? path.getAttribute('d') : null;
  });
}

// --- Where the pen is --------------------------------------------------------

/** Press P and wait for the pen's own surface to be under the pointer. */
export async function startPen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(page.getByTestId('pen-tool')).toHaveCount(1);
}

export async function stopPen(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await expect(page.getByTestId('pen-tool')).toHaveCount(0);
}

export async function penToolActive(page: Page): Promise<boolean> {
  return (await page.getByTestId('board-viewport').getAttribute('data-tool')) === 'pen';
}

/** Choose what the next stroke is drawn with (PRD pen.options). */
export async function pickPenColor(page: Page, color: PenColor): Promise<void> {
  await page.getByTestId(`pen-color-${color}`).click();
}

export async function pickPenThickness(page: Page, thickness: PenThickness): Promise<void> {
  await page.getByTestId(`pen-thickness-${thickness}`).click();
}

/** The pen options, as this screen shows them. */
export function penToolbarCount(page: Page): Promise<number> {
  return page.getByTestId('pen-toolbar').count();
}

// --- Screen <-> world --------------------------------------------------------

/** Screen position of a world point (CSS pixels from the viewport's top-left). */
export async function worldToScreen(page: Page, at: { x: number; y: number }): Promise<Box> {
  const origin = await markerCenter(page);
  const cam = await cameraOf(page);
  return { x: origin.x + at.x * cam.zoom, y: origin.y + at.y * cam.zoom };
}

export async function cameraOf(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** A point on the middle of a stroke's line, in screen pixels (PRD pen.select). */
export async function pointOnStrokeLine(page: Page, stroke: StrokeSnap): Promise<Box> {
  const points = scaledPoints(stroke);
  const middle = points[Math.floor(points.length / 2)] ?? points[0]!;
  // Step from a point that is on the line onto the segment after it, so the click is
  // squarely on the line and not on its very edge.
  const next = points[Math.floor(points.length / 2) + 1] ?? middle;
  const at = { x: (middle.x + next.x) / 2, y: (middle.y + next.y) / 2 };
  return worldToScreen(page, at);
}

// --- Real pointer work -------------------------------------------------------

/**
 * Draw a world path with the pen, slowly enough that the preview is real: every point
 * is a real pointer move, and each one is followed by a read of the preview so a
 * caller can watch it grow.
 */
export async function drawPenPath(
  page: Page,
  worldPoints: readonly { x: number; y: number }[],
  options: { watch?: (preview: string | null, index: number) => Promise<void> | void } = {},
): Promise<void> {
  const screen = [];
  for (const p of worldPoints) screen.push(await worldToScreen(page, p));
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for (let i = 1; i < screen.length; i++) {
    await page.mouse.move(screen[i].x, screen[i].y);
    if (options.watch) await options.watch(await previewPath(page), i);
  }
  await page.mouse.up();
}

/** Press and drag with whatever tool is active, from one screen point to another. */
export async function dragOnScreen(
  page: Page,
  from: Box,
  to: Box,
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/**
 * A real two-finger scroll over whatever is on top at that point. It is dispatched at
 * the topmost element, so a pen stroke in progress is what receives it — which is the
 * point: the pen's surface passes the wheel through to the board (PRD pen.navigation).
 */
export async function wheelOver(page: Page, at: Box, deltaY: number): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const el = document.elementFromPoint(x, y) ?? document.querySelector('[data-testid="board-viewport"]');
      if (!el) throw new Error('nothing under the pointer to scroll');
      const ev = new WheelEvent('wheel', {
        clientX: x,
        clientY: y,
        deltaX: 0,
        deltaY,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
    },
    { x: at.x, y: at.y, deltaY },
  );
}

/** Which element the pen's surface is, according to the browser. */
export function elementAt(page: Page, at: Box): Promise<string> {
  return page.evaluate((point) => {
    const el = document.elementFromPoint(point.x, point.y);
    if (!el) return 'nothing';
    const layer = (el as Element).closest('[data-testid="pen-tool"]');
    if (layer) return 'pen-tool';
    const note = (el as Element).closest('[data-note-id]');
    if (note) return 'sticky-note';
    return el.tagName.toLowerCase();
  }, at);
}

// --- Selection ---------------------------------------------------------------

export function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = window.__vidi6!.getSelection();
    if (sel.selectedIds) return sel.selectedIds;
    return sel.selectedId ? [sel.selectedId] : [];
  });
}

/** Click a stroke on its line, with the Select tool. */
export async function clickStroke(page: Page, stroke: StrokeSnap): Promise<void> {
  const at = await pointOnStrokeLine(page, stroke);
  await page.mouse.click(at.x, at.y);
}

/** Drag a resize handle of the current selection by a screen offset. */
export async function dragHandle(
  page: Page,
  handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
  dx: number,
  dy: number,
): Promise<void> {
  const el = page.getByTestId(`handle-${handle}`);
  await expect(el).toHaveCount(1);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no ${handle} handle on screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

// --- Console errors ----------------------------------------------------------

/** Everything the page complained about, for a test that expects silence. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}
