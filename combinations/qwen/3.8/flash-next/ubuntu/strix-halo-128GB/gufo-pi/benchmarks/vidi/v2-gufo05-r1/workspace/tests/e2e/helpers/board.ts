import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { GRID_SPACING_WORLD } from '../../../src/shared/config';
import { BOARD_ID_PATTERN } from '../../../src/shared/board-id';
import type { Camera } from '../../../src/client/canvas/camera';

/**
 * Boards, from the outside.
 *
 * Since the sharing story a board address is not something a test can invent: it comes
 * from `POST /api/boards`, or from pressing the home page's button. Both are here, and
 * which one a test uses is a choice about what the test is doing — a test about sharing
 * presses the button, because that is the thing a person does; a test about boards wants
 * a board and gets one without involving the home page.
 */

/**
 * What a board id looks like, unwrapped.
 *
 * `BOARD_ID_PATTERN` is anchored, which is right when a whole string is being tested and
 * wrong when an id sits inside a longer pattern for a URL or a field value: anchoring it
 * again matches nothing. Stripping the anchors keeps one definition of the shape.
 */
export const BOARD_ID = BOARD_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');

/** Create a board through the API and hand back the id the server gave it. */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  expect(response.status(), 'POST /api/boards did not create a board').toBe(201);
  const body = (await response.json()) as { id?: string };
  expect(body.id ?? '').toMatch(BOARD_ID_PATTERN);
  return body.id as string;
}

/** Whether the Worker calls this address a board. */
export async function checkBoard(request: APIRequestContext, boardId: string): Promise<number> {
  return (await request.get(`/api/boards/${boardId}`)).status();
}

/** The board id in a URL of the form `…/b/<id>`. */
export function boardIdFromUrl(url: string): string {
  return new URL(url).pathname.slice('/b/'.length);
}

/**
 * Arrive at a brand new board the only way a person can: home page, "New board", and
 * whatever address the server answers with. Returns that id.
 */
export async function openFreshBoard(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(BOARD_ID_PATTERN_URL);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  return boardIdFromUrl(page.url());
}

/** A board address, with the id checked against the pattern rather than by eye. */
const BOARD_ID_PATTERN_URL = new RegExp(`^https?://[^/]+/b/${BOARD_ID}$`);

export const ORIGIN_MARKER = '[data-testid="origin-marker"]';
export const BOARD_VIEWPORT = '[data-testid="board-viewport"]';
export const ZOOM_LABEL = '[data-testid="zoom-level"]';
export const NAVIGATION_HINT = '[data-testid="navigation-hint"]';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Where a dot-grid dot that sits exactly on the world origin is on screen. */
export async function originMarkerPosition(page: Page): Promise<ScreenPoint> {
  const box = await page.locator(ORIGIN_MARKER).boundingBox();
  if (!box) throw new Error('origin marker is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function readZoomLabel(page: Page): Promise<string> {
  return (await page.locator(ZOOM_LABEL).textContent()) ?? '';
}

export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.waitForFunction(() => typeof window.__vidi6?.setCamera === 'function');
  await page.evaluate((next) => window.__vidi6?.setCamera(next), camera);
  await expect
    .poll(() => readCamera(page), { message: `camera did not move to ${JSON.stringify(camera)}` })
    .toEqual(camera);
}

export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (!element) throw new Error('board viewport is missing');
    return {
      x: Number(element.dataset.cameraX),
      y: Number(element.dataset.cameraY),
      zoom: Number(element.dataset.cameraZoom),
    };
  });
}

/** Dot-grid spacing as the browser has it, in CSS pixels. */
export async function gridSpacingPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (!element) throw new Error('board viewport is missing');
    const size = getComputedStyle(element).backgroundSize;
    const first = Number.parseFloat(size.split(' ')[0] ?? '');
    return first;
  });
}

export async function expectedGridSpacing(zoom: number): Promise<number> {
  return GRID_SPACING_WORLD * zoom;
}

/** Drag the board from a point on empty board space. */
export async function dragBoard(
  page: Page,
  from: ScreenPoint,
  delta: ScreenPoint,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 });
  await page.mouse.up();
  await waitForSettledCamera(page);
}

/** Trackpad-style two-finger scroll. */
export async function scrollBoard(page: Page, delta: ScreenPoint): Promise<void> {
  await page.mouse.wheel(delta.x, delta.y);
  await waitForSettledCamera(page);
}

/** Pinch / Ctrl + scroll, centred on a screen point. */
export async function pinchAt(page: Page, point: ScreenPoint, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await waitForSettledCamera(page);
}

/**
 * Camera updates are coalesced to one per frame, so wait until the camera stops
 * changing before asserting on exact pixels.
 */
export async function waitForSettledCamera(page: Page): Promise<Camera> {
  let previous = await readCamera(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const current = await readCamera(page);
    if (
      current.x === previous.x &&
      current.y === previous.y &&
      current.zoom === previous.zoom
    ) {
      return current;
    }
    previous = current;
  }
  return previous;
}

export function withinTolerance(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
