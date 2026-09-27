// Shared e2E helpers: the board's stable pixel targets and the test-only camera hook.
import { expect, type Page } from "@playwright/test";

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from "../../../src/shared/config";
import type { Camera } from "../../../src/client/canvas/camera";

interface Vidi6Window {
  __vidi6?: {
    setCamera(cam: Camera): void;
    getCamera(): Camera;
  };
  visualViewport?: { scale: number };
}

const VIEWPORT_SELECTOR = '[data-testid="board-viewport"]';

export async function openBoard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(VIEWPORT_SELECTOR)).toBeVisible();
}

export const zoomLabel = (page: Page) => page.getByTestId("zoom-percent");
export const zoomInButton = (page: Page) =>
  page.getByRole("button", { name: "Zoom in" });
export const zoomOutButton = (page: Page) =>
  page.getByRole("button", { name: "Zoom out" });
export const resetButton = (page: Page) =>
  page.getByRole("button", { name: "Reset view" });
export const hint = (page: Page) => page.getByTestId("navigation-hint");

/** Screen position of the board's starting point (world 0,0), in CSS pixels. */
export async function originPoint(
  page: Page,
): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="origin-marker"]',
    );
    if (!el) throw new Error("origin marker is missing from the board");
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

/** The camera the board reports on its data attributes. */
export async function readCamera(page: Page): Promise<Camera> {
  return page.locator(VIEWPORT_SELECTOR).evaluate((el) => ({
    x: Number(el.getAttribute("data-camera-x")),
    y: Number(el.getAttribute("data-camera-y")),
    zoom: Number(el.getAttribute("data-camera-zoom")),
  }));
}

/** Dot grid spacing currently painted, in screen pixels. */
export async function gridSpacingPx(page: Page): Promise<number> {
  const size = await page
    .locator(VIEWPORT_SELECTOR)
    .evaluate((el) => getComputedStyle(el).backgroundSize);
  const match = /([\d.]+)px/.exec(size);
  if (!match) throw new Error(`unexpected background-size: ${size}`);
  return Number(match[1]);
}

/**
 * Jump the camera with the test-only hook. Only exists in the test build that
 * `npm run test:e2e` serves, and is how a test reaches
 * `UNBOUNDED_PAN_TESTED_EXTENT` without a million-pixel drag.
 */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((next) => {
    const api = (window as unknown as Vidi6Window).__vidi6;
    if (!api)
      throw new Error(
        "window.__vidi6 is missing: the board was not built with --mode test",
      );
    api.setCamera(next);
  }, cam);
  await expect
    .poll(() => readCamera(page), { timeout: 5_000 })
    .toEqual(expect.objectContaining({ x: cam.x, y: cam.y }));
}

/** The camera used for the "far away" cases. */
export function farAwayCamera(zoom = 1): Camera {
  return {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: UNBOUNDED_PAN_TESTED_EXTENT,
    zoom,
  };
}

/** Drag the empty board with the mouse by (dx, dy) screen pixels. */
export async function dragBoard(
  page: Page,
  dx: number,
  dy: number,
  from = { x: 300, y: 300 },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Pinch / Ctrl + wheel over the board. */
export async function ctrlWheel(page: Page, deltaY: number): Promise<void> {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
}

export async function pageZoomMetrics(
  page: Page,
): Promise<{ scale: number; dpr: number; width: number }> {
  return page.evaluate(() => {
    const win = window as unknown as Vidi6Window;
    return {
      scale: win.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      width: window.innerWidth,
    };
  });
}

/** Assert helper: grid spacing equals the world spacing at the current zoom. */
export function expectedGridSpacingPx(zoom: number): number {
  return GRID_SPACING_WORLD * zoom;
}
