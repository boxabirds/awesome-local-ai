import { expect, type Page } from '@playwright/test';
import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
} from '../../../src/shared/config';

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** Pixel tolerance for "within 1 pixel" acceptance criteria. */
export const PIXEL_TOLERANCE = 1;

export function expectClose(actual: number, expected: number, tolerance = PIXEL_TOLERANCE): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Camera updates are coalesced to one per animation frame, so a read that races the
 * commit sees the previous view. Two frames is always enough for the commit to land.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function readCamera(page: Page): Promise<Camera> {
  await settle(page);
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    return {
      x: Number(viewport.dataset.cameraX),
      y: Number(viewport.dataset.cameraY),
      zoom: Number(viewport.dataset.cameraZoom),
    };
  });
}

/**
 * The origin marker's box, read from the DOM rather than Playwright's bounding box so
 * it is still available when the marker is scrolled far off screen.
 */
export async function markerRect(page: Page): Promise<Rect> {
  await settle(page);
  const rect = await page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>('[data-testid="origin-marker"]');
    if (!marker) throw new Error('origin marker is not mounted');
    const box = marker.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  return {
    ...rect,
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
  };
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('[data-testid="zoom-label"]')).innerText();
}

export async function hintCount(page: Page): Promise<number> {
  return page.locator('[data-testid="navigation-hint"]').count();
}

/** Grid dot spacing in screen pixels, as the browser computed it. */
export async function gridSpacingPx(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    return Number.parseFloat(getComputedStyle(viewport).backgroundSize.split(' ')[0] ?? '0');
  });
}

export async function gridPositionPx(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) throw new Error('viewport is not mounted');
    const [x, y] = getComputedStyle(viewport).backgroundPosition.split(' ');
    return { x: Number.parseFloat(x ?? '0'), y: Number.parseFloat(y ?? '0') };
  });
}

/** Jump the camera anywhere on the board; only available in the test build. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    if (!window.__vidi6) throw new Error('test hook window.__vidi6 is missing');
    window.__vidi6.setCamera(next);
  }, camera);
  await page.waitForFunction((expected) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    if (!viewport) return false;
    return (
      Number(viewport.dataset.cameraX) === expected.x &&
      Number(viewport.dataset.cameraY) === expected.y &&
      Number(viewport.dataset.cameraZoom) === expected.zoom
    );
  }, camera);
}

export async function setCameraFarAway(page: Page, zoom = 1): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom,
  });
}

export async function setCameraToMaxZoom(page: Page): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX,
  });
}

/** Mouse drag across the board, in steps, like a real pointer would. */
export async function dragBoard(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 5,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
  await settle(page);
}

/** Wheel with Ctrl held (trackpad pinch is delivered the same way). */
export async function ctrlWheel(page: Page, deltaY: number, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  await settle(page);
}

export async function pressShortcut(page: Page, key: string): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await settle(page);
}

export const VIEWPORT_SIZE = { width: 1280, height: 800 };
export const VIEWPORT_CENTRE = { x: 640, y: 400 };

/** Navigate to the board and wait until the starting point is centred. */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  // Two separate waits so a failure says which one broke: a missing viewport means the
  // server is not serving the client build; a wrong camera means it did not open centred.
  try {
    await page.locator('[data-testid="viewport"]').waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
        if (!viewport) return false;
        return (
          Number(viewport.dataset.cameraX) === -window.innerWidth / 2 &&
          Number(viewport.dataset.cameraY) === -window.innerHeight / 2 &&
          Number(viewport.dataset.cameraZoom) === 1
        );
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    // A stale or wrong-mode build under the e2e server is the usual reason for getting here.
    throw new Error(`could not reach a centred board at ${page.url()}: ${String(error)}`);
  }
}

/**
 * The zoom values `+` produces, one per click, exactly as `zoomStep` computes them:
 * multiply by ZOOM_STEP_FACTOR, clamped to ZOOM_MAX.
 */
export function zoomLadder(startZoom = 1, targetZoom = ZOOM_MAX): number[] {
  const ladder: number[] = [];
  let zoom = startZoom;
  while (zoom < targetZoom) {
    zoom = Math.min(zoom * ZOOM_STEP_FACTOR, targetZoom);
    ladder.push(zoom);
  }
  return ladder;
}

/** Click `+` (or `-`) and wait for the camera to reach the expected zoom. */
export async function clickZoom(
  page: Page,
  direction: 'in' | 'out',
  expectedZoom: number,
): Promise<void> {
  const button = page.locator(
    direction === 'in' ? '[data-testid="zoom-in"]' : '[data-testid="zoom-out"]',
  );
  await expect(button).toBeEnabled();
  await button.click();
  await expect
    .poll(async () => Math.abs((await readCamera(page)).zoom - expectedZoom) < 1e-9, {
      timeout: 10_000,
    })
    .toBe(true);
}

/** Step with `+` until it is disabled; returns the zoom it stopped at. */
export async function stepToMaxZoom(page: Page): Promise<number> {
  for (const zoom of zoomLadder()) {
    await clickZoom(page, 'in', zoom);
  }
  const camera = await readCamera(page);
  return camera.zoom;
}
