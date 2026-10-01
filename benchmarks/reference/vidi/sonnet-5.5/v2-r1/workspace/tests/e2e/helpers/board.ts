import type { Page } from '@playwright/test';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Creates a board through the real API (boards must exist before anyone can open or connect to them). */
export async function createBoardId(baseURL = 'http://localhost:8787'): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** Opens a fresh board the way a person does: home page, New board. */
export async function openBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByTestId('board-viewport').waitFor();
  await page.waitForFunction(() => window.__vidi6 !== undefined);
}

export async function originCentre(page: Page) {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page): Promise<string> {
  return (await page.getByTestId('zoom-label').textContent()) ?? '';
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const cam = window.__vidi6?.getCamera();
    if (!cam) throw new Error('test hook missing');
    return cam;
  });
}

/** Screen position of one grid dot (the first whose tile lies at/after the origin of the background) and the tile size. */
export async function gridDot(page: Page) {
  return page.getByTestId('board-viewport').evaluate((el) => {
    const s = getComputedStyle(el);
    const size = parseFloat(s.backgroundSize);
    const [px, py] = s.backgroundPosition.split(' ').map(parseFloat);
    return { x: px + size / 2, y: py + size / 2, size };
  });
}

/** Difference a-b wrapped into (-size/2, size/2], for comparing positions of periodic dots. */
export function wrap(diff: number, size: number): number {
  return ((((diff + size / 2) % size) + size) % size) - size / 2;
}
