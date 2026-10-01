import type { Page } from '@playwright/test';
import type { StickySnapshot, ObjectSnapshot, TextSnapshot } from '../../../src/shared/board-model';

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

// --- Story 7 helpers ---

/** Programmatically add a sticky note at a world position via test hook. */
export async function addSticky(page: Page, x: number, y: number, text?: string, color?: string): Promise<string> {
  return page.evaluate(({ x, y, text, color }) => {
    return (window as any).__vidi6.addSticky!({ x, y }, text, color);
  }, { x, y, text, color });
}

/** Get the currently selected ids from the app. */
export async function getSelectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__vidi6.getSelectedIds?.() ?? []);
}

/** Shift+drag a marquee rectangle on the board from screen (x1,y1) to (x2,y2). */
export async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  // Find the board surface (grid layer or viewport)
  const surface = page.locator('[data-grid-layer="true"]');
  await surface.click({ position: { x: x1, y: y1 }, modifiers: ['Shift'], delay: 0, force: true }).catch(() => {});
  // Use raw mouse for precise drag control
  await page.mouse.move(x1, y1);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Get selection overlay handle count. */
export async function getHandleCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="resize-handle-"]').count();
}

// --- Story 9 text helpers ---

/** Programmatically add a text object at a world position via test hook. */
export async function addText(page: Page, x: number, y: number, text?: string, size?: string): Promise<string> {
  return page.evaluate(({ x, y, text, size }) => {
    return (window as any).__vidi6.addText!({ x, y }, text, size);
  }, { x, y, text, size });
}

/** Get text objects from the board snapshot. */
export async function getTextObjects(page: Page): Promise<TextSnapshot[]> {
  const board = await page.evaluate(() => [...((window as any).__vidi6?.getBoard?.() ?? [])]);
  return board.filter((o: ObjectSnapshot) => o.type === 'text') as TextSnapshot[];
}

/** Get a specific text object by id. */
export async function getTextObject(page: Page, id: string): Promise<TextSnapshot | undefined> {
  const objects = await getTextObjects(page);
  return objects.find((o) => o.id === id);
}

/** Get the bounding box of a text object by data-testid. */
export async function textObjectBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-text-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`text ${id} has no bounding box`);
  return box;
}

/** Activate text tool and click to create text at screen position. */
export async function createTextViaTool(page: Page, x: number, y: number): Promise<string> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  // Wait for text-editor to appear
  await page.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });
  // Get the id from the board (last-created text object)
  const objects = await getTextObjects(page);
  const created = objects[objects.length - 1];
  if (!created) throw new Error('text tool click did not create a text object');
  return created.id;
}

/** Type into the currently open text editor. */
export async function typeIntoTextEditor(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** Paste into the currently open text editor (single input event). */
export async function pasteIntoTextEditor(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
    if (!el) throw new Error('no text editor open');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
