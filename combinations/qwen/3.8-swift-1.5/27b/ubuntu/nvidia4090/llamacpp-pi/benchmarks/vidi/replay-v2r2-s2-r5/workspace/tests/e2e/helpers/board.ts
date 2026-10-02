import type { Page, Locator } from '@playwright/test';

export function getOriginMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.getByTestId('zoom-label').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6?.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}
