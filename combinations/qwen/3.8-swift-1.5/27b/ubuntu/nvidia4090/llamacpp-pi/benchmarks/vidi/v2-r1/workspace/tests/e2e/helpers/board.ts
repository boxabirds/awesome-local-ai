import { Page, Locator } from '@playwright/test';

export async function getOriginMarker(page: Page): Promise<Locator> {
  return page.getByTestId('origin-marker');
}

export async function getZoomLabel(page: Page): Promise<string> {
  const label = page.getByTestId('zoom-label');
  const text = await label.textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6.setCamera(x, y, zoom);
  }, { x, y, zoom });
}

export async function clickZoomIn(page: Page): Promise<void> {
  await page.getByLabel('Zoom in').click();
}

export async function clickZoomOut(page: Page): Promise<void> {
  await page.getByLabel('Zoom out').click();
}

export async function clickResetView(page: Page): Promise<void> {
  await page.getByLabel('Reset view').click();
}
