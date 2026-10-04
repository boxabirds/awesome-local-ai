import type { Page } from '@playwright/test';

/** Locate the origin crosshair marker (world 0,0). */
export function originMarker(page: Page) {
  return page.locator('[data-testid="origin"]');
}

/** Centre of the origin marker in viewport pixels. */
export async function originCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('Origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Read the current zoom percentage label text (e.g. "100%"). */
export async function readZoomLabel(page: Page): Promise<string> {
  return (await page.locator('.zoom-controls output').textContent())?.trim() ?? '';
}

/** Jump the camera via the test-only hook (test build only). */
export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
}
