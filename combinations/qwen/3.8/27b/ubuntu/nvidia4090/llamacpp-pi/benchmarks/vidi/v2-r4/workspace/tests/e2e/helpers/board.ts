/**
 * Helpers for the story 1 e2e tests.
 *
 * The origin marker (small crosshair at world 0,0, see design "Fixtures") is
 * the stable pixel target; `window.__vidi6` (enabled only in the `test` mode
 * build) is used to read the live camera and to jump far away.
 */
import type { Page } from "@playwright/test";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const VIEWPORT = { width: 1280, height: 800 };
export const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/** Centre of the origin marker in CSS pixels of the viewport. */
export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("origin-marker").boundingBox();
  if (!box) throw new Error("origin marker is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabelText(page: Page): Promise<string> {
  return (await page.getByTestId("zoom-label").textContent())?.trim() ?? "";
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Jump the camera (used for the "far 1e6" fixtures); waits one frame. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), camera);
  await page.waitForTimeout(100);
}

/** Page zoom state: must stay unchanged by board zoom gestures (TC-24, TC-31). */
export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}

/** The dot-grid background-size of the board viewport (CSS pixels). */
export async function gridBackgroundSize(page: Page): Promise<string> {
  return page
    .getByTestId("board-viewport")
    .evaluate((el) => getComputedStyle(el).backgroundSize);
}

/** Ctrl+wheel once at the given point (Playwright reports pixels, mode 0). */
export async function ctrlWheel(
  page: Page,
  point: { x: number; y: number },
  deltaY: number,
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
}

/** Drag from the current mouse position by (dx, dy) in viewport pixels. */
export async function drag(page: Page, start: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
}
