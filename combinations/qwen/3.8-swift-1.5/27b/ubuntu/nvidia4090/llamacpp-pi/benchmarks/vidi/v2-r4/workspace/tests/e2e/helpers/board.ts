import type { Page, Locator } from '@playwright/test';

export function getOriginMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function getZoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6?.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = getOriginMarker(page);
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
