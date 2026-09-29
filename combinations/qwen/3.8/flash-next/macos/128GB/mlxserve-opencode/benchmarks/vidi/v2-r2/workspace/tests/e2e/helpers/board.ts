import { Page } from '@playwright/test';

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker"]') as HTMLElement | null;
    if (!el) throw new Error('origin marker not found');
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

export async function readZoomLabel(page: Page): Promise<number> {
  const text = await page.textContent('output');
  return parseInt(text!);
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__vidi6, null, { timeout: 5000 });
  await page.evaluate(({ x, y, zoom }) => {
    const hook = (window as any).__vidi6;
    hook.setCamera({ x, y, zoom });
  }, { x, y, zoom });
  await page.waitForTimeout(50);
}
