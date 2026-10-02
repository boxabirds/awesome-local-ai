import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../../src/shared/config';
import { setCamera, zoomPercent } from './board';

export function createStickyButton(page: Page) {
  return page.getByRole('button', { name: 'Sticky note' });
}
export function editorBox(page: Page) {
  return page.getByRole('textbox', { name: 'Sticky note text' });
}
export function counterFor(page: Page) {
  return page.getByTestId('sticky-counter');
}
export function fadeFor(page: Page) {
  return page.getByTestId('sticky-overflow-fade');
}

export function viewportCenter(page: Page): { x: number; y: number } {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  return { x: vp.width / 2, y: vp.height / 2 };
}

export async function stickyIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-note-id]', (els) =>
    els.map((e) => e.getAttribute('data-note-id') as string),
  );
}

export function noteTestId(id: string): string {
  return `sticky-note-${id}`;
}

export async function noteWorldPos(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-note-id="${nid}"]`) as HTMLElement;
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  }, id);
}

export async function noteTextContent(page: Page, id: string): Promise<string> {
  return page.evaluate((nid) => {
    const el = document.querySelector(
      `[data-note-id="${nid}"] [data-testid="sticky-note-text"]`,
    );
    return el?.textContent ?? '';
  }, id);
}

export async function noteSelected(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (nid) =>
      document
        .querySelector(`[data-note-id="${nid}"]`)
        ?.getAttribute('data-selected') === 'true',
    id,
  );
}

export async function noteBackground(page: Page, id: string): Promise<string> {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-note-id="${nid}"]`) as HTMLElement;
    return getComputedStyle(el).backgroundColor;
  }, id);
}

/** Camera that puts world (0,0) at the viewport centre at the given zoom. */
export function cameraCenteringOrigin(page: Page, zoom: number): Camera {
  const c = viewportCenter(page);
  return { x: c.x / zoom, y: c.y / zoom, zoom };
}

/** Double-click empty board space to create a note, returning its id. */
export async function createByDblClick(
  page: Page,
  x: number,
  y: number,
): Promise<string> {
  const before = await stickyIds(page);
  await page.mouse.dblclick(x, y);
  await expect(editorBox(page)).toBeVisible();
  const after = await stickyIds(page);
  const created = after.find((id) => !before.includes(id));
  if (!created) throw new Error('double-click did not create a note');
  return created;
}

/** Click the toolbar "Sticky note" button; returns the new note id. */
export async function createByToolbar(page: Page): Promise<string> {
  const before = await stickyIds(page);
  await createStickyButton(page).click();
  await expect(editorBox(page)).toBeVisible();
  const after = await stickyIds(page);
  const created = after.find((id) => !before.includes(id));
  if (!created) throw new Error('toolbar did not create a note');
  return created;
}

/** End editing, keeping the note selected. */
export async function endEditing(page: Page): Promise<void> {
  await editorBox(page).focus();
  await page.keyboard.press('Escape');
  await expect(editorBox(page)).toHaveCount(0);
}

/** Type into the focused editor (single input event, IME-safe). */
export async function typeText(page: Page, text: string): Promise<void> {
  await editorBox(page).focus();
  await page.keyboard.insertText(text);
}

/** Grab a note by its centre and drag it by a screen-space delta. */
export async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await page.getByTestId(noteTestId(id)).boundingBox();
  if (!box) throw new Error('note not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
}

export function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export const COLOR_RGB: Record<StickyColor, string> = Object.fromEntries(
  (Object.keys(STICKY_COLORS) as StickyColor[]).map((k) => [
    k,
    hexToRgb(STICKY_COLORS[k]),
  ]),
) as Record<StickyColor, string>;

export { setCamera, zoomPercent, STICKY_SIZE_WORLD };
