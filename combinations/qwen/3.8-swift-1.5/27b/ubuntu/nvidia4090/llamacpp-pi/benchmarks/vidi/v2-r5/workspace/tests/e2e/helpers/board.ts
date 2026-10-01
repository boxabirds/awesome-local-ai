// tests/e2e/helpers/board.ts
import type { Page } from '@playwright/test';

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.locator('[data-testid="origin-marker"]');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  // The marker is centered at world (0,0), so its center is the origin position
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="zoom-label"]').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}

export async function dragBoard(page: Page, startX: number, startY: number, deltaX: number, deltaY: number): Promise<void> {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in small steps for realistic dragging
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + (deltaX * i) / steps,
      startY + (deltaY * i) / steps,
    );
  }
  await page.mouse.up();
}
