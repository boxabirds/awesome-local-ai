import { expect, type Page } from '@playwright/test';

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('world-layer')).toHaveAttribute('data-camera', /,/);
}

export function getCamera(page: Page): Promise<Cam> {
  return page.evaluate(() => (window as never as { __vidi6: { getCamera(): Cam } }).__vidi6.getCamera());
}

export async function setCamera(page: Page, camera: Cam): Promise<void> {
  await page.evaluate((c) => {
    (window as never as { __vidi6: { setCamera(cam: Cam): void } }).__vidi6.setCamera(c);
  }, camera);
  // Camera commits are coalesced to one render per animation frame; wait until
  // the rendered world layer reflects the new camera so later interactions use
  // handlers closed over the new state.
  const expected = `${camera.x},${camera.y},${camera.zoom}`;
  await expect
    .poll(
      async () =>
        page
          .getByTestId('world-layer')
          .getAttribute('data-camera'),
      { timeout: 5_000 },
    )
    .toBe(expected);
}

export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Waits until the rendered origin marker settles at the given position.
export async function waitForMarkerCenter(
  page: Page,
  x: number,
  y: number,
  tolerance = 1,
): Promise<{ x: number; y: number }> {
  await expect
    .poll(
      async () => {
        const c = await markerCenter(page);
        return Math.abs(c.x - x) <= tolerance && Math.abs(c.y - y) <= tolerance;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return markerCenter(page);
}

export interface NoteInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

export function getNotes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getNotes(): NoteInfo[] } };
      }
    ).__vidi6.board.getNotes(),
  );
}

export async function gridSpacingPx(page: Page): Promise<string> {
  return page
    .getByTestId('board-grid')
    .evaluate((el) => getComputedStyle(el).backgroundSize.split(' ')[0]);
}
