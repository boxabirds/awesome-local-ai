import { expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, type StickyColor } from '../../../src/shared/config';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { getCamera, VIEWPORT_HEIGHT, VIEWPORT_WIDTH, type ScreenPoint } from './board';
import { getNotes } from './sticky';

/**
 * Story 7 helpers (`sel.marquee_ui`, `sel.transform`, `sel.keyboard`).
 *
 * Selection is measured where the product shows it - `data-selected` on the
 * object itself, and the count in the selection bar - never from the client's
 * internal state, and object positions are read from the board model, which is
 * camera independent.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Put the camera at the world origin at 100%.
 *
 * With `x = y = 0` and `zoom = 1` a world point and its screen point are the same
 * numbers, which is what lets a marquee or a drag be described in board units.
 */
export async function setFlatCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__vidi6?.setCamera({ x: 0, y: 0, zoom: 1 });
  });
  await page.waitForTimeout(60);
}

export async function setZoomCamera(page: Page, zoom: number): Promise<void> {
  await page.evaluate((value) => {
    window.__vidi6?.setCamera({ x: 0, y: 0, zoom: value });
  }, zoom);
  await page.waitForTimeout(60);
}

/** World point -> screen point, using the camera the page is really on. */
export async function screenOf(page: Page, world: ScreenPoint): Promise<ScreenPoint> {
  const camera = await getCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** A note to place, in world units: its centre, and optionally what it says. */
export interface PlaceNote extends ScreenPoint {
  color?: StickyColor;
  text?: string;
}

/**
 * Fail loudly when a pointer would be sent outside the viewport.
 *
 * Playwright delivers synthesized mouse input in viewport coordinates, and at
 * least one browser reports nonsense (negative offsets, the document as the
 * target) once the pointer leaves it. A drag that leaves the screen is a broken
 * test, not a broken product, so it is rejected where it is written.
 */
function insideViewport(point: ScreenPoint, what: string): void {
  const margin = 4;
  if (
    point.x < margin ||
    point.y < margin ||
    point.x > VIEWPORT_WIDTH - margin ||
    point.y > VIEWPORT_HEIGHT - margin
  ) {
    throw new Error(
      `${what} would put the pointer at ${point.x},${point.y}, outside the ` +
        `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} viewport`,
    );
  }
}

/** Put notes on the board at known world centres (test setup). */
export async function createNotesAt(
  page: Page,
  centres: readonly PlaceNote[],
): Promise<string[]> {
  const ids = await page.evaluate((points) => {
    const api = window.__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return points.map((at) => api.createNote({ at }));
  }, centres);
  await expect
    .poll(
      async () => {
        const notes = await getNotes(page);
        return ids.every((id) => notes.some((note) => note.id === id));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
  return ids;
}

/** The board's objects by id, read from the model. */
export async function notesById(page: Page): Promise<Map<string, StickySnapshot>> {
  const notes = await getNotes(page);
  return new Map(notes.map((note) => [note.id, note]));
}

/** Ids the page has marked as selected, in DOM order. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>(
      '[data-testid^="sticky-note-"][data-selected="true"], [data-testid^="object-"][data-selected="true"]',
    );
    return Array.from(cards, (card) =>
      (card.getAttribute('data-testid') ?? '').replace(/^(sticky-note-|object-)/u, ''),
    );
  });
}

/** The selection bar's announced count, or null while no bar is shown. */
export async function selectionBarText(page: Page): Promise<string | null> {
  const count = await page.locator('[data-testid="selection-count"]').count();
  if (count === 0) {
    return null;
  }
  return (await page.locator('[data-testid="selection-count"]').first().textContent())?.trim() ?? '';
}

export async function waitForSelectionBarText(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => await selectionBarText(page), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the selection bar never read "${text}"`,
    })
    .toBe(text);
}

/** Wait until the page marks exactly these ids as selected. */
export async function waitForSelectedIds(page: Page, ids: readonly string[]): Promise<void> {
  const wanted = [...ids].sort().join(',');
  await expect
    .poll(async () => (await selectedIds(page)).sort().join(','), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the selection never became ${wanted}`,
    })
    .toBe(wanted);
}

/** Shift+drag across empty board space: a marquee, in world coordinates. */
export async function marqueeSelect(
  page: Page,
  fromWorld: ScreenPoint,
  toWorld: ScreenPoint,
): Promise<void> {
  const from = await screenOf(page, fromWorld);
  const to = await screenOf(page, toWorld);
  insideViewport(from, 'the marquee start');
  insideViewport(to, 'the marquee end');
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(80);
}

/** Press, drag and release at an arbitrary screen point. */
/**
 * Press, one continuous drag, release.
 *
 * One uninterrupted run of moves, deliberately: some browsers report nonsense
 * coordinates for a second `mouse.move` issued while the first is still being
 * handled, and a real drag is one motion anyway.
 */
export async function dragScreen(
  page: Page,
  from: ScreenPoint,
  dx: number,
  dy: number,
  steps = 16,
): Promise<void> {
  insideViewport(from, 'the drag start');
  insideViewport({ x: from.x + dx, y: from.y + dy }, 'the drag end');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Drag a board object from its centre by (dx, dy) screen pixels. */
export async function dragObjectBy(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<ScreenPoint> {
  const card = page.locator(`[data-testid="sticky-note-${id}"], [data-testid="object-${id}"]`);
  const box = await card.boundingBox();
  if (!box) {
    throw new Error(`object ${id} has no bounding box (is it on screen?)`);
  }
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragScreen(page, grab, dx, dy);
  return grab;
}

/** The middle of one of the selection's resize handles, on screen. */
export async function resizeHandleCentre(page: Page, handle: string): Promise<ScreenPoint> {
  const box = await page.locator(`[data-testid="resize-handle-${handle}"]`).boundingBox();
  if (!box) {
    throw new Error(`resize handle ${handle} is not rendered`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a resize handle by (dx, dy) screen pixels. Shift holds the proportions. */
export async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
  options: { shift?: boolean } = {},
): Promise<void> {
  const centre = await resizeHandleCentre(page, handle);
  if (options.shift) {
    await page.keyboard.down('Shift');
  }
  await dragScreen(page, centre, dx, dy);
  if (options.shift) {
    await page.keyboard.up('Shift');
  }
}

/** The selection bar's Delete action. */
export async function clickDeleteSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete selection' }).click();
  await page.waitForTimeout(80);
}

/** Wait until the model on this page holds exactly these positions. */
export async function waitForPositions(
  page: Page,
  expected: Record<string, { x: number; y: number }>,
  tolerance = 1,
): Promise<void> {
  const key = (notes: readonly StickySnapshot[]): string =>
    Object.entries(expected)
      .map(([id, want]) => {
        const note = notes.find((candidate) => candidate.id === id);
        if (!note) {
          return `${id}|missing`;
        }
        const close =
          Math.abs(note.x - want.x) <= tolerance && Math.abs(note.y - want.y) <= tolerance;
        return `${id}|${close ? 'ok' : `${note.x},${note.y}`}`;
      })
      .sort()
      .join(',');
  await expect
    .poll(async () => key(await getNotes(page)), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: 'the board never reached the expected positions',
    })
    .toBe(
      Object.entries(expected)
        .map(([id]) => `${id}|ok`)
        .sort()
        .join(','),
    );
}

/** Where this page's selection bounding box is drawn, on screen. */
export async function selectionBoxScreen(page: Page): Promise<Rect> {
  const box = await page.locator('[data-testid="selection-box"]').boundingBox();
  if (!box) {
    throw new Error('the selection outline is not rendered');
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}
