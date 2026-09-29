import { Page, Locator } from '@playwright/test';

export function getStickyNotes(page: Page): Locator {
  return page.locator('[data-testid="sticky-note-wrapper"]');
}

export function getNoteById(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"]`);
}

export async function getNoteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="sticky-note-wrapper"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.noteId as string),
  );
}

export async function getNoteWorldPos(page: Page, id: string): Promise<{ x: number; y: number; z: number }> {
  const el = page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"]`);
  const x = parseFloat((await el.getAttribute('data-x'))!);
  const y = parseFloat((await el.getAttribute('data-y'))!);
  const z = parseFloat((await el.getAttribute('data-z'))!);
  return { x, y, z };
}

export async function getNoteScreenBox(page: Page, id: string) {
  const box = await page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} not visible`);
  return box;
}

/** Real pointer drag of a note by (dx, dy) screen pixels from its centre. */
export async function dragNoteBy(page: Page, id: string, dx: number, dy: number, steps = 8): Promise<void> {
  const box = await getNoteScreenBox(page, id);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx / 2, startY + dy / 2, { steps });
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.mouse.up();
}

/** Creates a note by double-clicking a screen point; returns its id. */
export async function createNoteByDblclick(page: Page, x: number, y: number): Promise<string> {
  const before = await getNoteIds(page);
  await page.mouse.dblclick(x, y);
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length > prev,
    before.length,
  );
  const ids = await getNoteIds(page);
  return ids.find((id) => !before.includes(id))!;
}

/** Double-click the centre of an existing note to enter edit mode (textarea focused). */
export async function startEditingNote(page: Page, id: string): Promise<void> {
  const box = await getNoteScreenBox(page, id);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('[data-testid="sticky-textarea"]').waitFor({ state: 'attached' });
}

/** Type into the currently focused note editor. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 15 });
}

/** Click empty canvas to end editing / deselect. */
export async function clickEmptyCanvas(page: Page, x = 60, y = 60): Promise<void> {
  await page.mouse.click(x, y);
}

export function getCreateStickyButton(page: Page): Locator {
  return page.locator('[aria-label="Sticky note"]');
}

export function getNoteTextarea(page: Page): Locator {
  return page.locator('[data-testid="sticky-textarea"]');
}

export function getNoteText(page: Page, id: string): Locator {
  return page.locator(
    `[data-testid="sticky-note-wrapper"][data-note-id="${id}"] [data-testid="sticky-note-text"]`,
  );
}

export function getNoteToolbarFor(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"] [data-testid="note-toolbar"]`);
}

/** Seed a sticky note by double-clicking the screen point. Returns the note id. */
export async function seedSticky(page: Page, sx: number, sy: number): Promise<string> {
  return createNoteByDblclick(page, sx, sy);
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}
