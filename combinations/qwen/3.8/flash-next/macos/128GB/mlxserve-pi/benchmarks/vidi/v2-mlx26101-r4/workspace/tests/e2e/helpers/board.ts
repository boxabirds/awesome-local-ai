import { expect, type Locator, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../../src/shared/config';
import { isValidBoardId } from '../../../src/shared/board-id';

/** The camera as the page reports it. */
export interface CameraOnPage {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GridGeometry {
  /** Screen distance between two neighbouring dots. */
  period: number;
  /** Screen position of the dot drawn at the top-left of the painted area. */
  offsetX: number;
  offsetY: number;
}

/** The e2e window; the board fills it (`.board-app` is fixed, inset 0). */
export const BOARD_AREA = { width: 1280, height: 800 };

/** Tolerance for anything measured from rendered geometry (design: ±1 px). */
export const TOLERANCE_PX = 1;

/** Tolerance for zoom values compared with `toBeCloseTo` (digits). */
export const ZOOM_DIGITS = 6;

/** One pointer drag, as the PRD describes it: 200 px right, 100 px down. */
export const DRAG_RIGHT = 200;
export const DRAG_DOWN = 100;

/** Wheel delta used by the zoom gestures in these tests. */
export const WHEEL_DELTA = -240;

/**
 * Screen position of a world point. Deliberately written out here instead of
 * imported from `camera.ts`, so the e2e tests check the app against the model in
 * the design document rather than against itself.
 */
export function worldToScreen(cam: CameraOnPage, p: Point): Point {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export function screenToWorld(cam: CameraOnPage, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

/** `toBeCloseTo` digits that hold for numbers of the given magnitude. */
export function digitsFor(magnitude: number): number {
  // Doubles keep ~15 significant digits; leave 6 of them to the assertion.
  const exponent = Math.log10(Math.max(1, Math.abs(magnitude)));
  return Math.max(0, Math.floor(9 - exponent));
}

export function board(page: Page): Locator {
  return page.getByTestId('board-viewport');
}

export function worldLayer(page: Page): Locator {
  return page.getByTestId('world-layer');
}

export function originMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function hint(page: Page): Locator {
  return page.getByTestId('navigation-hint');
}

export function zoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reset view' });
}

/**
 * Makes a board the only way a board can be made: `POST /api/boards`, the call the New board button
 * makes, with the id chosen by the app and not by the test.
 *
 * This is not a convenience. Before story 5 a room would take a connection for any address and a
 * board appeared out of the first socket, so a test could invent an id and be right; now an id that
 * nobody created is a link to nowhere, and a helper that invented one would be testing a broken
 * product. Taking the id from the answer is also the assertion that the app can hand out a link at
 * all — which is the whole of story 5.
 */
export async function createBoardAt(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/boards`, { method: 'POST' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${baseUrl}/api/boards answered ${response.status}: ${body}`);
  }
  const id = (JSON.parse(body) as { id?: unknown }).id;
  if (typeof id !== 'string' || !isValidBoardId(id)) {
    throw new Error(`the new board's id is not a board id: ${body}`);
  }
  return id;
}

/** Where this page is being served from, which is what a board link is built out of. */
export async function appOrigin(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

/**
 * Opens the app and waits until the board and its test hooks are ready.
 *
 * With no board given, the app opens its own: the home page, a board made through the app's own
 * door, and the address that came back. Story 3 passes an id, so that several browsers can be
 * pointed at the same board — an id that has to have been created first, which is what
 * `createBoardAt` is for.
 */
export async function openBoard(page: Page, boardId?: string): Promise<void> {
  let id = boardId;
  if (id === undefined) {
    await page.goto('/');
    id = await createBoardAt(await appOrigin(page));
  }
  await page.goto(`/b/${id}`);
  // Checked before anything else, because every other assertion would fail with a
  // confusing message if the page being served was the production build.
  await expect
    .poll(() => hasTestHooks(page), { message: TEST_HOOKS_MISSING, timeout: HOOKS_TIMEOUT_MS })
    .toBe(true);
  await expect(board(page)).toBeVisible();
}

/** How long to wait for the app to boot and install its hooks. */
const HOOKS_TIMEOUT_MS = 15_000;

const TEST_HOOKS_MISSING =
  'window.__vidi6 is missing: the e2e suite must run against the test build. Run it as `npm run test:e2e` ' +
  '(which builds with `vite build --mode test` first). If a `wrangler dev` from an earlier run is still ' +
  'listening on the e2e port, Playwright reuses it and it serves the bundle it read at startup - stop that ' +
  'process and run again.';

async function hasTestHooks(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof window.__vidi6 === 'object' && window.__vidi6 !== null);
}

export async function getCamera(page: Page): Promise<CameraOnPage> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error(TEST_HOOKS_MISSING);
  return camera;
}

/**
 * Waits until what is on screen reflects the camera the page holds, and that the
 * controls say what the camera implies. The app coalesces camera updates into one
 * animation frame, so anything measured straight after an interaction could be a
 * frame behind; every test settles before it measures.
 */
export async function settled(page: Page): Promise<CameraOnPage> {
  await expect
    .poll(
      async () => {
        const camera = await getCamera(page);
        const rendered = await page.evaluate(() => {
          const layer = document.querySelector('[data-testid="world-layer"]');
          const label = document.querySelector('[data-testid="zoom-label"]');
          const zoomIn = document.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement | null;
          const zoomOut = document.querySelector('[data-testid="zoom-out"]') as HTMLButtonElement | null;
          const board = document.querySelector('[data-testid="board-viewport"]');
          return {
            transform: layer instanceof HTMLElement ? layer.style.transform : null,
            label: label?.textContent ?? null,
            zoomInDisabled: zoomIn?.disabled ?? null,
            zoomOutDisabled: zoomOut?.disabled ?? null,
            backgroundSize: board instanceof HTMLElement ? board.style.backgroundSize : null,
          };
        });
        return (
          sameNumbers(rendered.transform, renderedTransform(camera)) &&
          rendered.label === percentOf(camera.zoom) &&
          rendered.zoomInDisabled === !canZoomIn(camera) &&
          rendered.zoomOutDisabled === !canZoomOut(camera) &&
          sameNumbers(rendered.backgroundSize, renderedGridSize(camera.zoom))
        );
      },
      { message: 'the rendered board did not catch up with the camera' },
    )
    .toBe(true);
  return getCamera(page);
}

/**
 * The world layer transform the app is expected to render for a camera. Browsers
 * serialize large lengths as `1e+06px`, so this is compared numerically.
 */
export function renderedTransform(cam: CameraOnPage): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

/** Every number in a CSS value, in order (lengths, scale factors, matrix parts). */
export function numbers(value: string | null): number[] {
  if (value === null) return [];
  return (value.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

/**
 * Browsers keep only about six significant digits when they serialize a CSS value
 * (`translate(-1.00436e+06px)`), so rendered values are compared with a tolerance
 * that grows with the number: half a pixel, or the digits the CSSOM dropped.
 */
export function sameNumbers(actual: string | null, expected: string | null): boolean {
  const actualNumbers = numbers(actual);
  const expectedNumbers = numbers(expected);
  return (
    actualNumbers.length === expectedNumbers.length &&
    actualNumbers.every((value, index) => sameNumber(value, expectedNumbers[index] ?? 0))
  );
}

export function sameNumber(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= serializationTolerance(expected);
}

/** Tolerance for a value that went through CSS text round-tripping. */
export function serializationTolerance(expected: number): number {
  return Math.max(
    TOLERANCE_PX / 2,
    Math.abs(expected) * CSS_SERIALIZATION_RELATIVE_TOLERANCE,
  );
}

/** Six significant digits is a relative error of 5e-6; leave room for it. */
const CSS_SERIALIZATION_RELATIVE_TOLERANCE = 1e-5;

/** The camera says a zoom step in is possible. */
export function canZoomIn(cam: CameraOnPage): boolean {
  return cam.zoom < ZOOM_MAX;
}

/** The camera says a zoom step out is possible. */
export function canZoomOut(cam: CameraOnPage): boolean {
  return cam.zoom > ZOOM_MIN;
}

/** Jumps the camera; used for distances no test can drag across. */
export async function setCamera(page: Page, patch: Partial<CameraOnPage>): Promise<CameraOnPage> {
  await page.evaluate((patchToApply) => window.__vidi6?.setCamera(patchToApply), patch);
  return settled(page);
}

/** Centre of the origin marker on screen: the starting point (world 0, 0). */
export async function originOnScreen(page: Page): Promise<Point> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('the origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function gridGeometry(page: Page): Promise<GridGeometry> {
  const style = await board(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { backgroundSize: computed.backgroundSize, backgroundPosition: computed.backgroundPosition };
  });
  const [periodX = 0, periodY = periodX] = numbers(style.backgroundSize);
  const [offsetX = 0, offsetY = 0] = numbers(style.backgroundPosition);
  if (periodX !== periodY) {
    throw new Error(`the dot grid is not square: ${style.backgroundSize}`);
  }
  return { period: periodX, offsetX, offsetY };
}

/** Screen position of grid dot (column, row), counted from the painted origin. */
export async function gridDot(page: Page, column: number, row: number): Promise<Point> {
  const grid = await gridGeometry(page);
  return { x: grid.offsetX + column * grid.period, y: grid.offsetY + row * grid.period };
}

/** The grid dot nearest to a screen point, in screen coordinates. */
export async function nearestGridDot(page: Page, point: Point): Promise<Point> {
  const grid = await gridGeometry(page);
  const column = Math.round((point.x - grid.offsetX) / grid.period);
  const row = Math.round((point.y - grid.offsetY) / grid.period);
  return { x: grid.offsetX + column * grid.period, y: grid.offsetY + row * grid.period };
}

/** The grid period the camera implies: one world grid cell, scaled. */
export function expectedGridPeriod(zoom: number): number {
  return GRID_SPACING_WORLD * zoom;
}

/** The inline grid size the app is expected to render for a zoom. */
export function renderedGridSize(zoom: number): string {
  const period = expectedGridPeriod(zoom);
  return `${period}px ${period}px`;
}

/** The interaction state the board reports while a drag is in progress. */
export async function interactionState(page: Page): Promise<string | null> {
  return board(page).getAttribute('data-interaction-state');
}

export async function dragBoard(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Ctrl + wheel over the board, as a real browser delivers it. */
export async function ctrlWheel(page: Page, at: Point, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Wheel without any modifier: the board pans. */
export async function wheel(page: Page, deltaX: number, deltaY: number, at: Point): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(deltaX, deltaY);
}

/**
 * Clicks + until it is disabled and returns every label that was shown, in order.
 * A click that cannot change the zoom is not expected to change the label.
 */
export async function zoomInUntilDisabled(page: Page, limit = 40): Promise<string[]> {
  const labels: string[] = [];
  for (let clicks = 0; clicks < limit; clicks += 1) {
    await settled(page);
    if (await zoomInButton(page).isDisabled()) break;
    await zoomInButton(page).click();
    const camera = await settled(page);
    const label = percentOf(camera.zoom);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

/** The same for the zoom out button. */
export async function zoomOutUntilDisabled(page: Page, limit = 40): Promise<string[]> {
  const labels: string[] = [];
  for (let clicks = 0; clicks < limit; clicks += 1) {
    await settled(page);
    if (await zoomOutButton(page).isDisabled()) break;
    await zoomOutButton(page).click();
    const camera = await settled(page);
    const label = percentOf(camera.zoom);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

/** Asserts a rendered distance within the design's ±1 px. */
export function expectPixels(actual: number, expected: number, message = ''): void {
  expect(Math.abs(actual - expected), `${message} (got ${actual}, expected ${expected})`).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );
}

export function percentOf(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
