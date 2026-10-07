import { Page } from '@playwright/test';

/**
 * Locate the origin marker SVG inside the board viewport.
 */
export async function getOriginMarker(page: Page) {
  return page.locator('[data-testid="origin-marker"]');
}

/**
 * Read the zoom percentage label text.
 */
export async function getZoomLabel(page: Page): Promise<string> {
  const el = page.locator('[data-testid="zoom-percent"]');
  const text = await el.textContent();
  return text?.trim() ?? '';
}

/**
 * Check if a button is disabled.
 */
export async function isButtonDisabled(page: Page, ariaLabel: string): Promise<boolean> {
  const btn = page.getByRole('button', { name: ariaLabel });
  return btn.isEnabled().then((enabled) => !enabled);
}

/**
 * Set the camera state via the test hook (only available in test builds).
 */
export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => {
    if (window.__vidi6 && window.__vidi6.setCamera) {
      window.__vidi6.setCamera(c);
    }
  }, cam);
  // Wait for React to process the state update and re-render
  await page.waitForTimeout(50);
  // Also wait for rAF flush
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}

/**
 * Click the Zoom In button by aria-label.
 */
export async function clickZoomIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Zoom in/i }).click();
}

/**
 * Click the Reset view button.
 */
export async function clickReset(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset view' }).click();
}

/**
 * Move the mouse over the given element and perform drag operations.
 */
export async function dragFromTo(
  page: Page,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + dx, fromY + dy, { steps: 10 });
  await page.mouse.up();
}
