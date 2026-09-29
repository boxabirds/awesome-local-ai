import { type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import { settle } from './board';

/** Returns the currently selected object ids. */
export async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6!.selection?.() ?? []);
}

/** Shift+drag on empty board space: draws a marquee and returns selected ids. */
export async function marqueeSelect(page: Page, from: Point, to: Point): Promise<string[]> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
  return selection(page);
}

/** Select all with Ctrl+A (or Cmd+A on mac). */
export async function selectAll(page: Page): Promise<string[]> {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`);
  await settle(page);
  return selection(page);
}

/** Shift+click on a note to toggle it in the selection. */
export async function shiftClickNote(page: Page, id: string): Promise<string[]> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} not rendered`);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Shift');
  await settle(page);
  return selection(page);
}

/** Press a key and wait for settle. */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await settle(page);
}

/** Gets the SE resize handle screen position. */
export async function handlePosition(page: Page, dir: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'): Promise<Point> {
  const box = await page.locator(`[data-handle="${dir}"]`).boundingBox();
  if (!box) throw new Error(`handle ${dir} not found`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a resize handle by a screen delta. */
export async function resizeByHandle(page: Page, dir: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w', dx: number, dy: number, shift = false): Promise<void> {
  const pos = await handlePosition(page, dir);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.move(pos.x + dx / 2, pos.y + dy / 2, { steps: 4 });
  await page.mouse.move(pos.x + dx, pos.y + dy, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await settle(page);
}
