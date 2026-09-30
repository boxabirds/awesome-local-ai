import { type Page, expect } from '@playwright/test';

export interface ScreenPoint {
  x: number;
  y: number;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-testid="board-viewport"]');
}

// Screen position of the world origin marker (its rendered centre in px).
export async function originScreenPos(page: Page): Promise<ScreenPoint> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker"]');
    if (!el) throw new Error('origin marker not found');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

// The camera-model screen position (authoritative), from data attributes.
export async function originModelPos(page: Page): Promise<ScreenPoint> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker"]');
    if (!el) throw new Error('origin marker not found');
    return {
      x: Number(el.getAttribute('data-origin-screen-x')),
      y: Number(el.getAttribute('data-origin-screen-y')),
    };
  });
}

export async function readZoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label').textContent())?.trim() ?? '';
}

export async function zoomScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-world"]') as HTMLElement | null;
    if (!el) return NaN;
    const m = /scale\(([^)]+)\)/.exec(el.style.transform);
    return m ? Number.parseFloat(m[1]) : NaN;
  });
}

export async function gridBackgroundSize(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    return el ? el.style.backgroundSize : null;
  });
}

export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(c: Camera): void } }).__vidi6;
    if (!hook) throw new Error('window.__vidi6 test hook missing (is this a test build?)');
    hook.setCamera(c);
  }, camera);
}

export { expect };
