import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';

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

/** Board objects straight from the document (sorted by z, id). */
export async function getAppNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => {
    const hooks = (window as any).__vidi6;
    return hooks ? hooks.getNotes() : [];
  });
}

export async function waitForNoteCount(page: Page, count: number): Promise<StickySnapshot[]> {
  await expect
    .poll(async () => (await getAppNotes(page)).length, { message: `waiting for ${count} note(s)` })
    .toBe(count);
  return getAppNotes(page);
}

/** Screen box of a note element. */
export async function noteBox(page: Page, id: string) {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return box;
}

export function centre(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real mouse drag; several steps so the threshold is passed and frames run. */
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 6,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(50);
}

