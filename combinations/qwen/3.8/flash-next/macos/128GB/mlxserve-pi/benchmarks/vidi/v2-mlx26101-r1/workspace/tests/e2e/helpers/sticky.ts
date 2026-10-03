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

// --- story 7: multi-select helpers ----------------------------------------

import type { Handle } from '../../../src/shared/geometry';

export function selectionBar(page: Page) {
  return page.getByTestId('selection-bar');
}

export function selectionDeleteButton(page: Page) {
  return page.getByRole('button', { name: 'Delete selection' });
}

export function resizeHandle(page: Page, h: Handle) {
  return page.getByTestId(`resize-handle-${h}`);
}

/** The announced count as a number, or null when no multi-selection bar is shown. */
export async function selectionCount(page: Page): Promise<number | null> {
  const el = page.locator('.selection-count');
  if ((await el.count()) === 0) return null;
  const m = (await el.textContent())?.match(/(\d+)\s+selected/);
  return m ? Number(m[1]) : null;
}

/** Create notes at world points through the live model (test build only). */
export async function seedNotes(
  page: Page,
  positions: readonly { x: number; y: number }[],
): Promise<string[]> {
  const before = await page.locator('[data-note-id]').count();
  const ids = await page.evaluate((pts) => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('window.__vidi6TestBoard missing');
    return pts.map((p) => api.create(p));
  }, positions as { x: number; y: number }[]);
  await expect(page.locator('[data-note-id]')).toHaveCount(before + ids.length);
  return ids;
}

/**
 * Create notes centred on given SCREEN points (client px), whatever the current
 * camera is, so they are guaranteed on-screen and land exactly where asked. Uses
 * the live camera to convert screen -> world through the same helper the board does.
 */
export async function seedNotesAtScreen(
  page: Page,
  screenPoints: readonly { x: number; y: number }[],
): Promise<string[]> {
  const before = await page.locator('[data-note-id]').count();
  const ids = await page.evaluate((pts) => {
    const api = window.__vidi6TestBoard;
    const hooks = window.__vidi6;
    if (!api || !hooks) throw new Error('board test hooks missing');
    const cam = hooks.getCamera();
    return pts.map((p) =>
      api.create({ x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y }),
    );
  }, screenPoints as { x: number; y: number }[]);
  await expect(page.locator('[data-note-id]')).toHaveCount(before + ids.length);
  return ids;
}

/** The board's current zoom (test build only). */
export function readZoom(page: Page): Promise<number> {
  return page.evaluate(() => window.__vidi6!.getCamera().zoom);
}

/** The painted screen rectangle of a note (bounding box in client px). */
export async function noteScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.getByTestId(noteTestId(id)).boundingBox();
  if (!box) throw new Error(`note ${id} has no box`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** The note's CSS z-index as painted (its stacking level). */
export async function noteZIndex(page: Page, id: string): Promise<number> {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-note-id="${nid}"]`) as HTMLElement;
    return parseInt(getComputedStyle(el).zIndex || '0', 10);
  }, id);
}

/** Shift+drag a marquee between two screen points (empty board, no pan). */
export async function shiftMarquee(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
}

/** Press at a screen point and drag by a screen delta. */
export async function dragScreen(
  page: Page,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 8 });
  await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await page.mouse.up();
}

/** Drag a resize handle by a screen delta (grabs the handle's centre). */
export async function dragHandle(
  page: Page,
  h: Handle,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await resizeHandle(page, h).boundingBox();
  if (!box) throw new Error(`handle ${h} not visible`);
  await dragScreen(page, box.x + box.width / 2, box.y + box.height / 2, dx, dy);
}

/** The raw camera as the board reports it (test build only). */
export function readCameraRaw(
  page: Page,
): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const h = window.__vidi6;
    if (!h) throw new Error('window.__vidi6 missing');
    return h.getCamera();
  });
}

/** Ids painted with the selected outline, as a set. */
export async function selectedIdSet(page: Page): Promise<Set<string>> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-note-id][data-selected="true"]'),
    ).map((e) => e.getAttribute('data-note-id') as string),
  ).then((ids) => new Set(ids));
}

/** Click the first note and Shift-click the rest: select exactly these ids. */
export async function selectNotes(page: Page, ids: readonly string[]): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByTestId(noteTestId(ids[0]!)).click();
  for (const id of ids.slice(1)) {
    await page.keyboard.down('Shift');
    await page.getByTestId(noteTestId(id)).click();
    await page.keyboard.up('Shift');
  }
  await page.waitForTimeout(40);
}

/** Screen-space centre of a note. */
export async function noteCenter(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  const b = await noteScreenBox(page, id);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
