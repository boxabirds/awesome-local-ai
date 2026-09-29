import { Page, Locator } from '@playwright/test';

export function getOriginMarker(page: Page): Locator {
  return page.locator('[data-testid="origin-marker"]');
}

export function getViewport(page: Page): Locator {
  return page.locator('[data-testid="board-viewport"]');
}

export function getZoomLabel(page: Page): Locator {
  return page.locator('[data-testid="zoom-label"]');
}

export function getZoomInButton(page: Page): Locator {
  return page.locator('[aria-label="Zoom in"]');
}

export function getZoomOutButton(page: Page): Locator {
  return page.locator('[aria-label="Zoom out"]');
}

export function getResetButton(page: Page): Locator {
  return page.locator('[aria-label="Reset view"]');
}

export function getNavigationHint(page: Page): Locator {
  return page.locator('[data-testid="navigation-hint"]');
}

export async function getMarkerScreenPos(page: Page): Promise<{ x: number; y: number }> {
  const marker = getOriginMarker(page);
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  // Return center of the marker
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomPercent(page: Page): Promise<number> {
  const label = getZoomLabel(page);
  const text = await label.textContent();
  return parseInt(text!.replace('%', ''), 10);
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}

export async function getWorldLayerData(page: Page) {
  const world = page.locator('[data-testid="world-layer"]');
  const x = parseFloat((await world.getAttribute('data-camera-x'))!);
  const y = parseFloat((await world.getAttribute('data-camera-y'))!);
  const zoom = parseFloat((await world.getAttribute('data-camera-zoom'))!);
  return { x, y, zoom };
}
