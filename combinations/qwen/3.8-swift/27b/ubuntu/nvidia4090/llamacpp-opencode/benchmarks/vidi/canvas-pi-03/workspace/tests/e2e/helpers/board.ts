import type { Page } from '@playwright/test';

export async function getOriginMarkerPos(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('origin-marker');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const label = page.getByTestId('zoom-label');
  const text = await label.textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  // Wait for the test hook to be available
  await page.waitForFunction(() => (window as any).__vidi6 != null, null, { timeout: 5000 });
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}
