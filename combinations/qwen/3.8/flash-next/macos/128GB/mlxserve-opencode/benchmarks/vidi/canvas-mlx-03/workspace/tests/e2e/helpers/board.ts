import { type Page, expect } from '@playwright/test';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export async function openBoard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeVisible();
}

export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetButton(page: Page) {
  return page.getByRole('button', { name: 'Reset view' });
}

// Centre of the origin crosshair in viewport/CSS pixels.
export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Background size of the grid in CSS pixels ([gx, gy]).
export async function gridSpacingPx(page: Page): Promise<{ gx: number; gy: number }> {
  return page.getByTestId('viewport').evaluate((el) => {
    const cs = getComputedStyle(el).backgroundSize; // e.g. "24px 24px"
    const [gx, gy] = cs.split(/\s+/).map((s) => parseFloat(s));
    return { gx, gy };
  });
}

// Jump the camera via the test-only window.__vidi6 hook (test build only).
export async function setCamera(page: Page, cam: CameraState) {
  await page.waitForFunction(() => !!window.__vidi6);
  await page.evaluate(async (c) => {
    window.__vidi6!.setCamera(c);
    // Let the camera's requestAnimationFrame coalescing flush into the DOM.
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  }, cam);
}
