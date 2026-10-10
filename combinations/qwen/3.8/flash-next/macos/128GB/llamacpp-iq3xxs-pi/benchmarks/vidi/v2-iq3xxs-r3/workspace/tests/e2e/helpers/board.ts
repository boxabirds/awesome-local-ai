import { expect, type Locator, type Page } from '@playwright/test';

import type { Camera } from '../../../src/client/canvas/camera';
import type { WheelObservation } from './globals';

export const VIEWPORT = { width: 1280, height: 800 };
export const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
export const DRAG = { x: 200, y: 100 };
/** How far off-screen the e2e tests travel (TC-26, TC-27). */
export const FAR = 1_000_000;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GridGeometry {
  /** Tile size in screen pixels (`background-size`). */
  readonly spacing: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly image: string;
}

/** The camera the running board renders (test build only). */
export function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const api = window.__vidi6;
    if (!api) {
      throw new Error('window.__vidi6 is missing; build the client with `npm run build:test`');
    }
    return api.getCamera();
  });
}

/**
 * Poll until the camera matches `expected`. Board positions are compared in
 * board units; zoom is compared a thousand times coarser so one tolerance
 * covers both.
 */
export async function expectCamera(page: Page, expected: Camera, tolerance = 1e-6): Promise<void> {
  await expect
    .poll(async () => {
      const actual = await camera(page);
      return {
        dx: within(actual.x - expected.x, tolerance),
        dy: within(actual.y - expected.y, tolerance),
        dzoom: within(actual.zoom - expected.zoom, tolerance / 1000),
      };
    })
    .toEqual({ dx: 0, dy: 0, dzoom: 0 });
}

/** The zoom label always shows the camera it renders. */
export async function expectZoomLabel(page: Page, expected: string): Promise<void> {
  await expect(page.getByTestId('zoom-percent')).toHaveText(expected);
  await expect
    .poll(async () => {
      const label = await page.getByTestId('zoom-percent').textContent();
      const zoom = (await camera(page)).zoom;
      return label === `${Math.round(zoom * 100)}%`;
    })
    .toBe(true);
}

/** Centre of a test-marked element, in viewport coordinates. */
export async function centreOf(page: Page, testId: string): Promise<Point> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`no bounding box for [data-testid=${testId}]`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Assert two viewport coordinates agree to within `tolerancePx` pixels. */
export function expectPoints(actual: Point, expected: Point, tolerancePx = 1): void {
  expect({
    dx: within(actual.x - expected.x, tolerancePx),
    dy: within(actual.y - expected.y, tolerancePx),
  }).toEqual({ dx: 0, dy: 0 });
}

/**
 * Cursor over the board area: `grab` when idle, `grabbing` while dragging.
 * Measured because the PRD asks for a grabbing hand, and a hand-shaped cursor
 * cannot be asserted any other way.
 */
export async function boardCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const surface = (document as unknown as Document).querySelector('[data-pan-surface]');
    if (!surface) throw new Error('no pan surface found');
    return getComputedStyle(surface).cursor;
  });
}

/**
 * Console errors and uncaught exceptions seen by the page. A board that is
 * working correctly produces none.
 */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

export function gridGeometry(page: Page): Promise<GridGeometry> {
  // Parsed in the page: the helper functions here do not exist there.
  return page.getByTestId('board-grid').evaluate((element) => {
    const parse = (value: string): number[] =>
      (value.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const style = getComputedStyle(element);
    const [spacing = Number.NaN] = parse(style.backgroundSize);
    const [offsetX = Number.NaN, offsetY = Number.NaN] = parse(style.backgroundPosition);
    return { spacing, offsetX, offsetY, image: style.backgroundImage };
  });
}

/**
 * Poll until a test marker sits at `expected` (± `tolerancePx`). The DOM trails
 * the camera state by an animation frame, so marker checks always poll.
 */
export async function expectMarkerAt(
  page: Page,
  testId: string,
  expected: Point,
  tolerancePx = 1,
): Promise<void> {
  await expect
    .poll(async () => {
      const actual = await centreOf(page, testId);
      return {
        dx: within(actual.x - expected.x, tolerancePx),
        dy: within(actual.y - expected.y, tolerancePx),
      };
    })
    .toEqual({ dx: 0, dy: 0 });
}

/**
 * Click a button until it disables itself, and report how many clicks that
 * took. A button can become disabled between the check and the click, which is
 * why the click failure is not fatal on its own.
 */
export async function clickUntilDisabled(button: Locator, maxClicks: number): Promise<number> {
  let clicks = 0;
  for (let attempts = 0; attempts <= maxClicks; attempts += 1) {
    if (await button.isDisabled()) return clicks;
    try {
      await button.click({ timeout: 2_000 });
      clicks += 1;
    } catch (error) {
      if (!(await button.isDisabled())) throw error;
      return clicks;
    }
  }
  throw new Error(`still enabled after ${maxClicks} clicks`);
}

/** Press, move and release on the board surface. */
export async function dragBoard(page: Page, from: Point, delta: Point, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
}

/** Ctrl + wheel over the board (the Windows/Linux pinch gesture). */
export async function ctrlWheel(page: Page, at: Point, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Plain wheel/trackpad scroll over the board. */
export async function scrollBoard(page: Page, at: Point, delta: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(delta.x, delta.y);
}

/**
 * Record the wheel events the page receives, so assertions can use the deltas
 * the browser reported rather than the ones we asked for (Firefox rescales
 * wheel deltas).
 */
export async function installWheelProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__wheelObservations = [];
    const surface = document.querySelector('[data-testid="board-viewport"]');
    if (!surface) throw new Error('board surface is missing');
    surface.addEventListener(
      'wheel',
      (event) => {
        const wheelEvent = event as WheelEvent;
        window.__wheelObservations.push({
          deltaX: wheelEvent.deltaX,
          deltaY: wheelEvent.deltaY,
          deltaMode: wheelEvent.deltaMode,
          ctrlKey: wheelEvent.ctrlKey,
          metaKey: wheelEvent.metaKey,
        });
      },
      { capture: true },
    );
  });
}

export function wheelObservations(page: Page): Promise<WheelObservation[]> {
  return page.evaluate(() => window.__wheelObservations ?? []);
}

/** Page zoom indicators: neither may change when the board zooms. */
export function pageZoom(page: Page): Promise<{ scale: number; devicePixelRatio: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

export function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Zero when `value` is within tolerance, otherwise the value itself. */
function within(value: number, tolerance: number): number {
  return Math.abs(value) <= tolerance ? 0 : Number(value.toFixed(6));
}
