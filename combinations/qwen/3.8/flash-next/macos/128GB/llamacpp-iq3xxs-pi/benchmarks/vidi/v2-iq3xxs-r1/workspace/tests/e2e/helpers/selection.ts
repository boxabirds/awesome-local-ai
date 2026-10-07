import type { Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';

/** Get the board snapshot from the test hook. */
export function snapshot(page: Page): Promise<readonly StickySnapshot[]> {
  return page.evaluate(() => window.__vidi6!.getSnapshot());
}

/** Get selection state from the test hook. */
export function getSelectionState(page: Page): Promise<{
  selectedId: string | null;
  editingId: string | null;
  selectedIds?: string[];
}> {
  return page.evaluate(() => window.__vidi6!.getSelection());
}

/** All selected ids (multi-select aware). */
export async function selectedIds(page: Page): Promise<string[]> {
  const sel = await getSelectionState(page);
  if (sel.selectedIds) return sel.selectedIds;
  return sel.selectedId ? [sel.selectedId] : [];
}

/** Screen box of a note identified by its document id. */
export async function noteBox(page: Page, id: string): Promise<{
  left: number; top: number; width: number; height: number; x: number; y: number;
}> {
  return page.evaluate((noteId) => {
    const el = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!el) throw new Error(`note ${noteId} missing`);
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }, id);
}

/** Select all notes via Ctrl+A. */
export async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
}

/** Click a note to select it. */
export async function clickNote(page: Page, id: string): Promise<void> {
  const box = await noteBox(page, id);
  await page.mouse.click(box.x, box.y);
}

/** Shift+drag on empty space for marquee selection. */
export async function marqueeSelect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Drag a note from its current center to a new position. */
export async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  const box = await noteBox(page, id);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + dx, box.y + dy, { steps });
  await page.mouse.up();
}

/** Get world position of a note from snapshot. */
export async function notePosition(page: Page, id: string): Promise<{ x: number; y: number }> {
  const all = await snapshot(page);
  const note = all.find((n) => n.id === id);
  if (!note) throw new Error(`note ${id} not in snapshot`);
  return { x: note.x, y: note.y };
}



/**
 * Create notes via double-click at given screen positions, returning their ids.
 * Each note is created, typed with its index, and deselected.
 */
export async function createNotesByDoubleClick(
  page: Page,
  positions: { x: number; y: number }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const before = new Set((await snapshot(page)).map((n) => n.id));
    await page.mouse.dblclick(pos.x, pos.y);
    await page.keyboard.type(`note${i}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      (prev) => {
        const all = window.__vidi6!.getSnapshot();
        return all.length > prev;
      },
      before.size,
      { timeout: 5000 },
    );
    const all = await snapshot(page);
    const created = all.find((n) => !before.has(n.id));
    if (created) ids.push(created.id);
  }
  // Click empty space to clear selection
  await page.mouse.click(20, 20);
  return ids;
}

/** Get the camera from the test hook. */
export function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

/** Press Delete key. */
export async function pressDelete(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
}

/** Press arrow keys. */
export async function pressArrow(page: Page, direction: string, shift = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.press(`Arrow${direction}`);
  if (shift) await page.keyboard.up('Shift');
}
