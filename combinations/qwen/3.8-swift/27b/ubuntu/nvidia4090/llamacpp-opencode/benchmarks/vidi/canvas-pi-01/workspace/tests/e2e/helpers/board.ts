// E2E helpers for the board (spec: Fixtures — locate origin marker, read zoom
// label, set camera via the test-only window.__vidi6 hook).
//
// NOTE: functions passed to page.evaluate / page.waitForFunction must be
// fully self-contained (no references to module-scope helpers), because
// Playwright serializes them into the browser.

import { Locator, Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import { UNBOUNDED_PAN_TESTED_EXTENT } from '../../../src/shared/config';

export { UNBOUNDED_PAN_TESTED_EXTENT };

type TestCamera = Camera;

/** The crosshair rendered at the board's starting point (world 0,0). */
export function originMarker(page: Page): Locator {
  return page.locator('[data-testid="origin-marker"]');
}

/** Screen centre of the origin marker, i.e. where world (0,0) is drawn. */
export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await originMarker(page).boundingBox()) ?? undefined;
  if (box === undefined) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom percentage label. */
export function zoomLabel(page: Page): Locator {
  return page.locator('output[aria-live="polite"]');
}

/**
 * Jump the camera via the test-only hook and wait until it has rendered.
 * Numeric comparison: JS stringifies large numbers exponentially
 * (e.g. -1000000 -> "-1e+06"), so string comparison is not reliable.
 */
export async function setCamera(page: Page, cam: TestCamera): Promise<void> {
  await page.evaluate((c) => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    hook.setCamera(c);
  }, cam); // window.__vidi6 is declared in src/client/canvas/testHooks.ts
  await page.waitForFunction((c) => {
    const el = document.querySelector('[data-testid="board-world"]');
    if (el === null) return false;
    const m = /scale\(([-\d.e+]+)\)\s+translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
      (el as HTMLElement).style.transform,
    );
    if (m === null) return false;
    const EPS = 1e-9;
    return (
      Math.abs(Number(m[1]) - c.zoom) < EPS &&
      Math.abs(-Number(m[2]) - c.x) < EPS &&
      Math.abs(-Number(m[3]) - c.y) < EPS
    );
  }, cam);
}

/** The camera implied by the rendered world-layer transform. */
export async function cameraFromRender(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-world"]') as HTMLElement;
    const m = /scale\(([-\d.e+]+)\)\s+translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
      el.style.transform,
    );
    if (m === null) throw new Error('cannot parse world transform: ' + el.style.transform);
    return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
  });
}

/**
 * Yield to the browser so queued synthetic input events (e.g. the
 * pointerdown handler) have been processed. WebKit + Playwright can reorder
 * event delivery when the main thread is fast; a task boundary after
 * mouse.down() makes the drag deterministic.
 */
export async function settleInput(page: Page): Promise<void> {
  await settleCamera(page);
}

/**
 * Drag the board from (x, y) by (dx, dy), verifying the pan actually started
 * (WebKit + Playwright can drop the pointerdown under load; retry if so).
 */
export async function dragBoard(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await settleInput(page);
    const panning = await page.evaluate(
      () =>
        document.querySelector('[data-testid="board-viewport"]')?.getAttribute('data-panning'),
    );
    if (panning === 'true') break;
    // pointerdown was lost: release and retry.
    await page.mouse.up();
    await settleCamera(page);
  }
  await page.mouse.move(x + dx, y + dy, { steps: 20 });
  await page.mouse.up();
  await settleCamera(page);
}

/**
 * Camera updates are coalesced with requestAnimationFrame; wait two frames so
 * a pending commit has definitely rendered before measuring the camera.
 */
export async function settleCamera(page: Page): Promise<void> {
  await page.evaluate(() =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

/**
 * Wait until the app has initialised its home view (100% centred) so tests
 * can measure positions from a known starting camera. Only waits — never
 * sets the camera, so it cannot dismiss the first-use hint.
 */
export async function homeViewReady(page: Page): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  await page.waitForFunction(
    (c) => {
      const el = document.querySelector('[data-testid="board-world"]');
      if (el === null) return false;
      const m = /scale\(([-\d.e+]+)\)\s+translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(
        (el as HTMLElement).style.transform,
      );
      if (m === null) return false;
      const EPS = 1e-9;
      return (
        Math.abs(Number(m[1]) - c.zoom) < EPS &&
        Math.abs(-Number(m[2]) - c.x) < EPS &&
        Math.abs(-Number(m[3]) - c.y) < EPS
      );
    },
    { x: -width / 2, y: -height / 2, zoom: 1 },
  );
}
