/**
 * E2E helpers: the origin marker is the board's own pixel target, the zoom
 * label is the zoom readout, and `window.__vidi6` jumps the camera (test builds
 * only) so a test can travel UNBOUNDED_PAN_TESTED_EXTENT units without dragging
 * a million pixels.
 */

import { expect, request as playwrightRequest, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../../src/shared/config';

export const BOARD_SIZE: Size = { width: 1280, height: 800 };
export const BOARD_CENTRE: Point = { x: BOARD_SIZE.width / 2, y: BOARD_SIZE.height / 2 };

/**
 * Make a board the way the app does — `POST /api/boards` — and hand back its id.
 *
 * Story 5 made an address mean "somebody made this", so a test can no longer invent an id and
 * expect a board to be there: it has to ask for one first. `openBoard` and `openSession` both do.
 */
export async function createBoardOn(origin: string = BASE_URL): Promise<string> {
  // Its own request context, pointed at whichever server the caller means; the persistence
  // specs run a server of their own.
  const context = await playwrightRequest.newContext({ baseURL: origin });
  try {
    const response = await context.post('/api/boards');
    if (!response.ok()) {
      throw new Error(`could not create a board (${response.status()})`);
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string') {
      throw new Error('the create response held no board id');
    }
    return body.id;
  } finally {
    await context.dispose();
  }
}

/**
 * The board is on screen, and the world and the screen agree about where it is.
 *
 * The camera starts at the world origin and the viewport's own size arrives a frame later,
 * with the first `ResizeObserver` report. A test that double-clicks inside that gap is clicking
 * at a world point worked out from a viewport of no size at all, and the note lands half a
 * viewport away. Nobody's hand is fast enough to do that; Playwright's mouse is, and story 5
 * widened the gap by mounting the board after a fetch rather than on document load. So "the
 * board is open" now includes the frame in which it found out how big it is.
 */
export async function waitForBoard(page: Page): Promise<void> {
  const viewport = page.locator('[data-vidi6="viewport"]');
  await expect(viewport).toBeVisible();
  await expect
    .poll(
      async () => {
        const camera = await getCamera(page);
        const size = await viewport.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight
        }));
        return camera.x === -size.width / 2 && camera.y === -size.height / 2
          ? true
          : `camera ${JSON.stringify(camera)} against a ${size.width}x${size.height} viewport`;
      },
      { message: 'the board should be drawn with its camera centred on the viewport' }
    )
    .toBe(true);
}

/**
 * A board of this test's own, open on screen, and its id.
 *
 * Story 5 made the address mean something, so "open a board" is now two steps: ask for one,
 * then go where it is. Every older spec gets its board this way, which is also how the oldest
 * of them (story 1's camera) was always meant to have one.
 */
export async function openBoard(page: Page): Promise<string> {
  const boardId = await createBoardOn();
  await page.goto(`/b/${boardId}`);
  await waitForBoard(page);
  return boardId;
}

export function marker(page: Page) {
  return page.getByTestId('origin-marker');
}

/** Screen-space centre of the board's starting point, in CSS pixels. */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await marker(page).boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}


/** The zoom readout, as a locator so assertions auto-wait for the board. */
export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-percent');
}

export async function getCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error('window.__vidi6 test hook is not available in this build');
  return camera;
}

/**
 * What the board document holds: every note, bottom to top. Reading the document
 * rather than the screen is what makes assertions about stored positions and text
 * exact. (Test builds only, through `window.__vidi6`.)
 */
export async function getBoard(page: Page): Promise<StickySnapshot[]> {
  const notes = await page.evaluate(() => window.__vidi6?.getBoard());
  if (!notes) throw new Error('window.__vidi6 test hook is not available in this build');
  return [...notes];
}

/** Move the camera somewhere directly, then wait for the board to show it. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => window.__vidi6?.setCamera(next), camera);
  await expect
    .poll(() => getCamera(page), { message: `camera should become ${JSON.stringify(camera)}` })
    .toEqual(camera);
}

/** Pan far away and zoom in, so Reset view has something to undo. */
export async function goToFarAwayMaxZoom(page: Page): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX
  });
}

/** Drag the board with a real mouse, from one screen point to another. */
export async function dragBoard(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 4;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
  await page.mouse.up();
}

/** Ctrl/Cmd + wheel (a trackpad pinch) at a screen point. */
export async function pinchAt(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Computed background geometry of the dot grid. */
export async function gridStyle(page: Page): Promise<{ size: string; position: string }> {
  return page.locator('[data-vidi6="viewport"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
}

/** How big the zoom control renders — proof the browser page zoom did not change. */
export async function zoomControlBox(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.locator('[data-vidi6="zoom-controls"]').boundingBox();
  if (!box) throw new Error('zoom control has no bounding box');
  return { width: box.width, height: box.height };
}

/** Page-level zoom signals that must never change when the board zooms. */
export async function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio
  }));
}

/* ------------------------------------------------------------------ story 2 */

/** The sticky notes on screen, in the order the document draws them. */
export function notes(page: Page): Locator {
  return page.locator('[data-vidi6="sticky"]');
}

/** The nth sticky note. */
export function note(page: Page, index: number): Locator {
  return notes(page).nth(index);
}

/** The text a note shows (not the editor). */
export function noteText(page: Page, index: number): Locator {
  return note(page, index).locator('[data-testid="sticky-text"]');
}

/** The textarea of the note being edited. */
export function stickyInput(page: Page): Locator {
  return page.locator('[data-testid="sticky-input"]');
}

/** The floating toolbar of a note. */
export function noteToolbar(page: Page, index = 0): Locator {
  return note(page, index).locator('[data-vidi6="note-toolbar"]');
}

/** A colour swatch in a note's toolbar. */
export function swatch(page: Page, colour: string, index = 0): Locator {
  return noteToolbar(page, index).locator(`[data-vidi6="note-swatch"][data-color="${colour}"]`);
}

/** The bin button of a note's toolbar. */
export function deleteButton(page: Page, index = 0): Locator {
  return noteToolbar(page, index).locator('[data-vidi6="note-delete"]');
}

/** The left-side tool palette. */
export function stickyToolButton(page: Page): Locator {
  return page.locator('[data-vidi6="tool-sticky"]');
}

/** Double-click empty board space, which creates a note centred there. */
export async function doubleClickBoard(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
}

/** Press, move in steps and release, as a drag of the mouse does. */
export async function dragByMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
  }
  await page.mouse.up();
}

/** Drag a note by its centre by a screen delta. */
export async function dragNote(
  page: Page,
  index: number,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const box = await note(page, index).boundingBox();
  if (!box) throw new Error('note has no box to grab');
  await dragByMouse(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2 + deltaX, y: box.y + box.height / 2 + deltaY }
  );
}

/** A rendered length in CSS pixels, e.g. the font size of a note's text. */
export async function cssPixels(
  page: Page,
  selector: string,
  property: string
): Promise<number> {
  const value = await page.locator(selector).first().evaluate((element, name) => {
    const declared = getComputedStyle(element)[name as keyof CSSStyleDeclaration];
    // jsdom-free browsers always resolve lengths to px.
    return String(declared);
  }, property);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${property} of ${selector} is not a length: ${value}`);
  }
  return parsed;
}

/** The character counter of the note being edited, or null. */
export function counter(page: Page): Locator {
  return page.locator('[data-testid="sticky-counter"]');
}
