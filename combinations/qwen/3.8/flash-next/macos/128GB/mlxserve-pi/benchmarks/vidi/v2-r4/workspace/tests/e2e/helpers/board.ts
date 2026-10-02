import { expect, type Page } from '@playwright/test';

import type { Vidi6TestApi } from '../../../src/client/canvas/testHooks';
import { GRID_SPACING_WORLD, ZOOM_MAX, ZOOM_MIN } from '../../../src/shared/config';

export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 800;
/** Tolerance the PRD verification steps allow in screen pixels. */
export const PIXEL_TOLERANCE = 1;

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The dot grid as painted on the board surface. */
export interface Grid {
  /** Offset of the first dot from the top-left of the board area. */
  readonly offset: Point;
  /** Distance between dots, in screen pixels. */
  readonly spacing: Point;
}

declare global {
  interface Window {
    /** Installed by the `test` build only (see src/client/canvas/testHooks.ts). */
    __vidi6?: Vidi6TestApi;
  }
}

export const wrap = (value: number, modulo: number): number => ((value % modulo) + modulo) % modulo;

export const worldToScreen = (cam: Camera, p: Point): Point => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

export const screenToWorld = (cam: Camera, p: Point): Point => ({
  x: cam.x + p.x / cam.zoom,
  y: cam.y + p.y / cam.zoom,
});

export const resetCameraOf = (width = VIEWPORT_WIDTH, height = VIEWPORT_HEIGHT): Camera => ({
  x: -width / 2,
  y: -height / 2,
  zoom: 1,
});

/**
 * The camera after only zooming: the world point at the centre of the view (the
 * start of the board) stays in the middle, so the camera position moves.
 */
export const zoomedCamera = (
  zoom: number,
  width = VIEWPORT_WIDTH,
  height = VIEWPORT_HEIGHT,
): Camera => ({
  x: -width / (2 * zoom),
  y: -height / (2 * zoom),
  zoom,
});

/** Grid dot nearest to a screen point. */
export const dotNearest = (cam: Camera, p: Point): Point => ({
  x: Math.round(screenToWorld(cam, p).x / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
  y: Math.round(screenToWorld(cam, p).y / GRID_SPACING_WORLD) * GRID_SPACING_WORLD,
});

const board = (page: Page) => page.locator('[data-testid="board-viewport"]');
const originMarker = (page: Page) => page.locator('[data-testid="origin-marker"]');

export const zoomLabel = (page: Page) => page.locator('[data-testid="zoom-percent"]');
export const zoomOutButton = (page: Page) => page.getByRole('button', { name: 'Zoom out' });
export const zoomInButton = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
export const resetViewButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });
export const navigationHint = (page: Page) => page.locator('[data-testid="navigation-hint"]');

/** Wait for the animation frame in which coalesced camera updates are applied. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

/** Centre of the origin crosshair, in viewport pixels. */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('the origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function expectMarkerAt(page: Page, expected: Point, tolerance = PIXEL_TOLERANCE) {
  await expect
    .poll(async () => {
      const centre = await markerCentre(page);
      return Math.max(Math.abs(centre.x - expected.x), Math.abs(centre.y - expected.y));
    })
    .toBeLessThanOrEqual(tolerance);
}

/** The camera the board has actually rendered (test-only hook). */
export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing — serve the test build');
    return api.getCamera();
  });
}

export async function expectCamera(page: Page, expected: Camera, tolerance = 1e-6) {
  await expect
    .poll(async () => {
      const cam = await readCamera(page);
      return Math.max(
        Math.abs(cam.x - expected.x),
        Math.abs(cam.y - expected.y),
        Math.abs(cam.zoom - expected.zoom),
      );
    })
    .toBeLessThanOrEqual(tolerance);
}

/** Jump the camera a long way in one step (dragging a million px is impractical). */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((cam) => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing — serve the test build');
    api.setCamera(cam);
  }, camera);
  await settle(page);
  await expectCamera(page, camera);
}

/** Centred view of a location `distance` board units from the start. */
export const farView = (distance: number, zoom: number, sign = 1): Camera => ({
  x: sign * distance - VIEWPORT_WIDTH / (2 * zoom),
  y: sign * distance - VIEWPORT_HEIGHT / (2 * zoom),
  zoom,
});

/** The painted dot grid. */
export async function readGrid(page: Page): Promise<Grid> {
  const painted = await board(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { position: style.backgroundPosition, size: style.backgroundSize };
  });
  const position = painted.position.match(/(-?[\d.]+)px\s+(-?[\d.]+)px/);
  const size = painted.size.match(/(-?[\d.]+)px\s+(-?[\d.]+)px/);
  if (!position || !size) {
    throw new Error(`cannot read the dot grid: ${painted.position} / ${painted.size}`);
  }
  return {
    offset: { x: Number.parseFloat(position[1]), y: Number.parseFloat(position[2]) },
    spacing: { x: Number.parseFloat(size[1]), y: Number.parseFloat(size[2]) },
  };
}

export async function expectGridSpacing(page: Page, zoom: number) {
  await expect
    .poll(async () => {
      const grid = await readGrid(page);
      return Math.max(
        Math.abs(grid.spacing.x - GRID_SPACING_WORLD * zoom),
        Math.abs(grid.spacing.y - GRID_SPACING_WORLD * zoom),
      );
    })
    .toBeLessThanOrEqual(PIXEL_TOLERANCE);
}

/** Distance between two phases of a repeating pattern, in pixels. */
export const phaseDistance = (a: number, b: number, spacing: number): number => {
  const difference = Math.abs(wrap(a, spacing) - wrap(b, spacing));
  return Math.min(difference, spacing - difference);
};

/**
 * The dot grid is a repeating pattern, so "the same dot moved by (dx, dy)" is the
 * statement that its painted offset moved by (dx, dy) modulo the spacing.
 */
export async function expectGridPhaseMoved(page: Page, before: Grid, dx: number, dy: number) {
  await expect
    .poll(async () => {
      const after = await readGrid(page);
      expect(after.spacing.x).toBeCloseTo(before.spacing.x, 1);
      return Math.max(
        phaseDistance(after.offset.x - before.offset.x, dx, before.spacing.x),
        phaseDistance(after.offset.y - before.offset.y, dy, before.spacing.y),
      );
    })
    .toBeLessThanOrEqual(PIXEL_TOLERANCE);
}

/** The painted grid is where the camera says it is. */
export async function expectGridPhaseForCamera(page: Page, cam: Camera) {
  await expect
    .poll(async () => {
      const grid = await readGrid(page);
      return Math.max(
        phaseDistance(grid.offset.x, -cam.x * cam.zoom, grid.spacing.x),
        phaseDistance(grid.offset.y, -cam.y * cam.zoom, grid.spacing.y),
      );
    })
    .toBeLessThanOrEqual(PIXEL_TOLERANCE);
}

/** Press a Ctrl (or Cmd) shortcut with real key events. */
export async function pressWithModifier(
  page: Page,
  modifier: 'Control' | 'Meta',
  key: string,
): Promise<void> {
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
  await settle(page);
}

/** Scroll with Ctrl held, as a trackpad pinch or a wheel with the key down. */
export async function ctrlWheel(page: Page, deltaY: number, deltaX = 0): Promise<void> {
  await page.keyboard.down('Control');
  await page.mouse.wheel(deltaX, deltaY);
  await page.keyboard.up('Control');
  await settle(page);
}

/** Drag the board with the mouse: press, move in steps, release. */
export async function dragBoard(page: Page, from: Point, delta: Point, steps = 6): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await settle(page);
}

export const ZOOM_LIMITS = { ZOOM_MIN, ZOOM_MAX };
