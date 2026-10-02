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

// ---------------------------------------------------------------------------
// Story 7: selecting, moving, resizing and deleting several objects at once.
// ---------------------------------------------------------------------------

/** Ids of the objects the app currently has selected. */
export async function getSelectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as any).__vidi6?.getSelectedIds?.() ?? [])]);
}

export async function getEditingId(page: Page): Promise<string | null> {
  return page.evaluate(() => ((window as any).__vidi6?.getEditingId?.() ?? null) as string | null);
}

/** Create a sticky note centred on a world position, without selecting it. */
export async function addStickyAt(page: Page, at: { x: number; y: number }, text = ''): Promise<string> {
  return page.evaluate(
    ({ p, t }) => (window as any).__vidi6!.addSticky!(p, t || undefined) as string,
    { p: at, t: text },
  );
}

/** Hold Shift and drag a box across empty board space. */
export async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

export async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
}

/** The centre of a resize handle, in screen pixels. */
export async function handleCentre(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`resize-handle-${name}`).boundingBox();
  if (!box) throw new Error(`resize handle ${name} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a resize handle by (dx, dy) screen pixels. */
export async function dragHandle(
  page: Page,
  name: string,
  dx: number,
  dy: number,
): Promise<void> {
  const from = await handleCentre(page, name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.5, from.y + dy * 0.5, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The rendered world transform, to prove the camera did not move. */
export async function worldTransform(
  page: Page,
): Promise<{ zoom: number; e: number; f: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="world-layer"]');
    if (!el) throw new Error('no world layer');
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { zoom: m.a, e: m.e, f: m.f };
  });
}

export async function scrollPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
}

/** Text of the selection bar, or null when no group bar is shown. */
export async function selectionBarText(page: Page): Promise<string | null> {
  const bar = page.getByTestId('selection-bar');
  return (await bar.count()) === 0 ? null : ((await bar.textContent()) ?? '');
}

/** Object count for a raw object id taken from the board snapshot. */
export function positionsOf(board: { id: string; x: number; y: number }[]): string {
  return board
    .map((o) => `${o.id}:${Math.round(o.x * 1000) / 1000},${Math.round(o.y * 1000) / 1000}`)
    .sort()
    .join('|');
}
