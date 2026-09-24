import type { Locator, Page } from '@playwright/test';

/** Exact hint text from the PRD. */
export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** The crosshair marker at world (0,0): a stable pixel target in every build. */
export function originMarker(page: Page): Locator {
  return page.locator('[data-testid="origin-marker"]');
}

/** The zoom percentage label (aria-live output). */
export function zoomLabel(page: Page): Locator {
  return page.locator('output[aria-live="polite"]');
}

/** Board viewport element (owns the dot grid background). */
export function boardViewport(page: Page): Locator {
  return page.locator('.vidi6-viewport');
}

/** Jump the camera directly (test hook; present only in `--mode test` builds). */
export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
}

/** Drag by (dx, dy) CSS pixels starting from (fromX, fromY). */
export async function dragBy(
  page: Page,
  dx: number,
  dy: number,
  from?: { x: number; y: number },
): Promise<void> {
  const start = from ?? { x: 640, y: 400 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

/** Parsed inline backgroundPosition of the viewport (the dot grid anchor). */
export async function gridBackgroundPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('.vidi6-viewport') as HTMLElement;
    const [x = '', y = ''] = el.style.backgroundPosition.split(/\s+/);
    return { x: parseFloat(x), y: parseFloat(y) };
  });
}

/** Parsed inline backgroundSize of the viewport (the dot grid spacing). */
export async function gridBackgroundSize(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('.vidi6-viewport') as HTMLElement;
    const [w = '', h = ''] = el.style.backgroundSize.split(/\s+/);
    return { w: parseFloat(w), h: parseFloat(h) };
  });
}

/**
 * Wait for the next animation frame. Headless WebKit may report stale
 * geometry (getBoundingClientRect) within the same frame a CSS transform
 * changed; waiting one frame makes boundingBox() consistent.
 */
export async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Browser page-zoom facts, to prove board gestures never zoom the page. */
export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}
