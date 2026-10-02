import type { Page } from '@playwright/test';
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
  // Wait for the world layer to actually carry the new transform, otherwise a
  // later bounding-box measurement can catch the previous frame.
  await page.waitForFunction(
    (c) => {
      const el = document.querySelector('[data-testid="world-layer"]') as HTMLElement | null;
      if (!el) return false;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return (
        Math.abs(m.a - c.zoom) < 1e-6 &&
        Math.abs(m.e + c.x * c.zoom) < 0.5 &&
        Math.abs(m.f + c.y * c.zoom) < 0.5
      );
    },
    cam,
  );
}

/** The board document, straight from the app's Y.Doc. */
export async function getBoard(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => [...((window as any).__vidi6?.getBoard?.() ?? [])]);
}

export async function getNote(page: Page, id: string): Promise<StickySnapshot | undefined> {
  return (await getBoard(page)).find((n) => n.id === id);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export async function noteBox(page: Page, id: string): Promise<Box> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Double-click empty board space; returns the created note (already in edit mode). */
export async function createNoteAt(page: Page, x: number, y: number): Promise<StickySnapshot> {
  const before = await getBoard(page);
  await page.mouse.dblclick(x, y);
  await page
    .locator('[data-testid="sticky-note-editor"]')
    .waitFor({ state: 'visible', timeout: 3000 });
  const after = await getBoard(page);
  const created = after.find((n) => !before.some((b) => b.id === n.id));
  if (!created) throw new Error('double-click did not create a note');
  return created;
}

/** Type into the currently open note editor. */
export async function typeIntoNote(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** Replace the editor's content the way a paste does (one input event). */
export async function pasteIntoNote(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-note-editor"]');
    if (!el) throw new Error('no note editor open');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

export async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

export async function selectNote(page: Page, id: string): Promise<void> {
  const box = await noteBox(page, id);
  await page.mouse.click(box.cx, box.cy);
}

/**
 * Drag a note by (dx, dy) screen pixels, grabbing it at the fraction (fx, fy)
 * of its own box.
 */
export async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  grab = { fx: 0.3, fy: 0.3 },
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const box = await noteBox(page, id);
  const from = { x: box.x + box.width * grab.fx, y: box.y + box.height * grab.fy };
  const to = { x: from.x + dx, y: from.y + dy };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.4, from.y + dy * 0.4, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  return { from, to };
}

export async function clickSwatch(page: Page, colour: string): Promise<void> {
  await page.getByRole('button', { name: `${colour} colour` }).click();
}

export async function clickDeleteNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete note' }).click();
}

/** Which note (id) is painted at a screen point — the stacking order as drawn. */
export async function noteIdAtPoint(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const note = el?.closest('[data-note-id]') as HTMLElement | null;
      return note?.dataset.noteId ?? null;
    },
    { x, y },
  );
}

/** Font size and clipping of the note's text element. */
export async function noteTextMetrics(
  page: Page,
  id: string,
): Promise<{ fontSize: number; scrollHeight: number; clientHeight: number; faded: boolean }> {
  return page.evaluate((noteId) => {
    const el = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"] [data-testid="sticky-note-text"]`);
    if (!el) throw new Error('note text element not found');
    return {
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      faded: Boolean(el.closest('[data-note-id]')?.querySelector('[data-testid="sticky-note-fade"]')),
    };
  }, id);
}

// ---- Story 7 helpers -------------------------------------------------------

/** Selected object ids, straight from the app. */
export async function getSelectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as any).__vidi6?.getSelection?.() ?? [])]);
}

export async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
}

export async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/** Create a note and leave it non-editing (unselected). */
export async function createNoteClosed(page: Page, x: number, y: number): Promise<StickySnapshot> {
  const note = await createNoteAt(page, x, y);
  await closeEditor(page);
  return note;
}

/** A plain screen-space drag from one point to another. */
export async function dragScreen(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.4, y0 + (y1 - y0) * 0.4, { steps: 5 });
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
}

/**
 * Shift-drag a marquee over empty board space. Keeping shift held through the
 * button-up unions with the current selection; releasing it first replaces.
 */
export async function marqueeSelect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  keepShift = true,
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
  await page.mouse.move(x1, y1, { steps: 5 });
  if (!keepShift) await page.keyboard.up('Shift');
  await page.mouse.up();
  if (keepShift) await page.keyboard.up('Shift');
}

/** Drag one selected object by a screen delta (moves the whole selection). */
export async function dragSelectedBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await noteBox(page, id);
  await dragScreen(page, box.cx, box.cy, box.cx + dx, box.cy + dy);
}

export async function shiftClickNote(page: Page, id: string): Promise<void> {
  const box = await noteBox(page, id);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.cx, box.cy);
  await page.keyboard.up('Shift');
}

/** Drag a bounding-box resize handle by a screen delta. */
export async function dragResizeHandle(
  page: Page,
  handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  dx: number,
  dy: number,
): Promise<void> {
  const h = page.locator(`[data-testid="resize-handle-${handle}"]`);
  await h.waitFor({ state: 'visible', timeout: 3000 });
  const box = await h.boundingBox();
  if (!box) throw new Error(`resize handle ${handle} not found`);
  await dragScreen(page, box.x + box.width / 2, box.y + box.height / 2, box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

export async function clickDeleteSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete selection' }).click();
}

export async function clickBringToFront(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bring to front' }).click();
}
