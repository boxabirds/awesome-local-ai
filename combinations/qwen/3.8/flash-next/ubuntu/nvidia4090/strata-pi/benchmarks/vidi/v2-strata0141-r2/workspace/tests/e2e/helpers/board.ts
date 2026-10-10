import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

interface Vidi6TestApi {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  getZoomPercent(): number;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export interface PointLike {
  x: number;
  y: number;
}

/** Wait until React has repainted the board (state updates land on the next frames). */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export interface GridInfo {
  size: number;
  offsetX: number;
  offsetY: number;
  backgroundSize: string;
}

export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label').textContent()) ?? '';
}

/** Centre of the origin crosshair, in CSS pixels relative to the window. */
export async function originCentre(page: Page): Promise<PointLike> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) {
    throw new Error('origin marker is not visible');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Jump the camera anywhere on the board using the test-only hook. */
export async function setBoardCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 is missing: build with `npm run build:test`');
    }
    window.__vidi6.setCamera(next);
  }, camera);
  await page.waitForFunction(
    (next) => {
      const current = window.__vidi6?.getCamera();
      return !!current && current.x === next.x && current.y === next.y && current.zoom === next.zoom;
    },
    camera,
  );
}

export async function currentCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) {
    throw new Error('window.__vidi6 is missing: build with `npm run build:test`');
  }
  return camera;
}

export async function gridInfo(page: Page): Promise<GridInfo> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="board-grid"]');
    if (!el) {
      throw new Error('board grid is missing');
    }
    return {
      size: Number(el.getAttribute('data-grid-size')),
      offsetX: Number(el.getAttribute('data-grid-offset-x')),
      offsetY: Number(el.getAttribute('data-grid-offset-y')),
      backgroundSize: getComputedStyle(el).backgroundSize,
    };
  });
}

export async function dragBoard(page: Page, from: PointLike, to: PointLike): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 5;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
}

export async function scrollBoard(page: Page, deltaX: number, deltaY: number): Promise<void> {
  await page.mouse.wheel(deltaX, deltaY);
}

export async function ctrlWheel(page: Page, at: PointLike, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

export async function pressWithControl(page: Page, key: 'Equal' | 'Minus' | 'Digit0'): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/**
 * Click a control that may disable itself as a result of the click. If the
 * actionability wait loses that race, the state assertions in the test decide
 * the outcome instead of Playwright hanging on a disabled button.
 */
export async function clickSettled(locator: ReturnType<Page['getByTestId']>): Promise<void> {
  try {
    await locator.click({ timeout: 4000 });
  } catch {
    // The control became disabled mid-action; that is expected at a zoom limit.
  }
}

export async function clickZoomIn(page: Page): Promise<void> {
  await clickSettled(page.getByTestId('zoom-in'));
}

export async function clickZoomOut(page: Page): Promise<void> {
  await clickSettled(page.getByTestId('zoom-out'));
}

export async function clickResetView(page: Page): Promise<void> {
  await clickSettled(page.getByTestId('reset-view'));
}

export async function pageZoomState(page: Page): Promise<{ scale: number; devicePixelRatio: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

/** Board area size as the browser sees it. */
export async function boardSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
}

/** Poll until the origin marker sits at `expected` (within `tolerance` CSS pixels). */
export async function expectCentre(page: Page, expected: PointLike, tolerance = 1): Promise<void> {
  await expect
    .poll(
      async () => {
        const centre = await originCentre(page);
        return Math.abs(centre.x - expected.x) <= tolerance && Math.abs(centre.y - expected.y) <= tolerance;
      },
      { timeout: 5000, message: `board never moved the origin marker to ${expected.x}, ${expected.y}` },
    )
    .toBe(true);
}

/** Poll until the board camera matches `expected` within `tolerance` world units. */
export async function expectCamera(page: Page, expected: Camera, tolerance = 1e-6): Promise<void> {
  await expect
    .poll(
      async () => {
        const camera = await currentCamera(page);
        return (
          Math.abs(camera.x - expected.x) <= tolerance &&
          Math.abs(camera.y - expected.y) <= tolerance &&
          Math.abs(camera.zoom - expected.zoom) <= tolerance
        );
      },
      { timeout: 5000, message: `board camera never reached ${JSON.stringify(expected)}` },
    )
    .toBe(true);
}

export function zoomLabelLocator(page: Page) {
  return page.getByTestId('zoom-label');
}
