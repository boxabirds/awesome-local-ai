import type { Page } from '@playwright/test';

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('origin-marker');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label').textContent()) ?? '';
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}
