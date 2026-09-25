import { type Page } from '@playwright/test';

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.locator('[data-testid="origin-marker"]');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="zoom-label"]').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}

export async function getHintVisible(page: Page): Promise<boolean> {
  const hint = page.locator('[data-testid="navigation-hint"]');
  return await hint.isVisible();
}
