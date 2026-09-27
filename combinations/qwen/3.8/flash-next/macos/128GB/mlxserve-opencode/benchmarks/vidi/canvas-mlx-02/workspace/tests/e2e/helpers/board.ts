import type { Page } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../../src/shared/config.ts';

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

const VIEWPORT_SELECTOR = '[data-testid="viewport"]';

export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(VIEWPORT_SELECTOR);
}

export async function setCamera(page: Page, cam: Cam): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(cam: Cam): void } }).__vidi6;
    if (!hook) throw new Error('__vidi6 test hook missing (was the app built in test mode?)');
    hook.setCamera(c);
  }, cam);
  // let React flush the state update
  await page.waitForTimeout(50);
}

export async function originCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="origin-marker"]').boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('[data-testid="zoom-label"]').innerText()).trim();
}

export interface GridInfo {
  size: number; // tile size in px
  posX: number;
  posY: number;
}

export async function readGrid(page: Page): Promise<GridInfo> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="viewport"]') as HTMLElement;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.backgroundSize.split(' ')[0]);
    const pos = cs.backgroundPosition.split(' ').map(parseFloat);
    return { size, posX: pos[0], posY: pos[1] };
  });
}

// Expected grid tile size (px) for a given zoom, from the product setting.
export function expectedTile(zoom: number): number {
  return GRID_SPACING_WORLD * zoom;
}

export function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

// Dispatch a real WheelEvent (with ctrl held) so the board's non-passive
// listener runs and can preventDefault; returns whether it was default-prevented.
export async function dispatchCtrlWheel(
  page: Page,
  point: { x: number; y: number },
  deltaY: number,
): Promise<boolean> {
  return page.evaluate(
    ({ x, y, dy }) => {
      const el = document.querySelector('[data-testid="viewport"]') as HTMLElement;
      const e = new WheelEvent('wheel', {
        deltaY: dy,
        ctrlKey: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    { x: point.x, y: point.y, dy: deltaY },
  );
}

export async function pageZoom(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}
