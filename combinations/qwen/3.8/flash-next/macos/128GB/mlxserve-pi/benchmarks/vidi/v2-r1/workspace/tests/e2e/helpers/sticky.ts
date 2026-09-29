import { expect, type Locator, type Page } from '@playwright/test';

export interface NoteInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  color: string;
  selected: boolean;
  editing: boolean;
  text: string;
}

const notesRoot = (page: Page): Locator => page.locator('[data-testid="sticky-note"]');

export const noteCount = async (page: Page): Promise<number> =>
  notesRoot(page).count();

/** All notes' world geometry and state, in board order. */
export async function readNotes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'),
    );
    return nodes.map((el) => ({
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      z: Number(el.dataset.z),
      color: el.dataset.color ?? '',
      selected: el.dataset.selected === 'true',
      editing: !!el.querySelector('textarea'),
      text: el.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '',
    }));
  });
}

export async function noteAt(page: Page, index: number): Promise<NoteInfo> {
  const all = await readNotes(page);
  const note = all[index];
  if (!note) throw new Error(`no sticky note at index ${index}`);
  return note;
}

/** Centre of a note in screen coordinates (getBoundingClientRect centre). */
export async function noteCentre(
  page: Page,
  index: number,
): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate((i) => {
    const el = document.querySelectorAll('[data-testid="sticky-note"]')[i];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, index);
  if (!centre) throw new Error(`no sticky note at index ${index}`);
  return centre;
}

/** Double-click empty board space to create a note there and open its editor. */
export async function createNote(
  page: Page,
  x: number,
  y: number,
  text?: string,
): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid="sticky-note"] textarea');
  if (text !== undefined) await page.keyboard.type(text);
}

/** Finish the open editor (Escape) so the note is selected with its toolbar. */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="note-toolbar"]').first()).toBeVisible();
}

/** Drag an existing note (selected or not) by (dx, dy) screen pixels. */
export async function dragNote(
  page: Page,
  index: number,
  dx: number,
  dy: number,
): Promise<void> {
  const centre = await noteCentre(page, index);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + dx / 2, centre.y + dy / 2, { steps: 5 });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 5 });
  await page.mouse.up();
}

export const deleteButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Delete note' });

export const swatch = (page: Page, colour: string): Locator =>
  page.getByRole('button', { name: `${colour} colour` });

export const editorText = (page: Page): Locator =>
  page.locator('[data-testid="sticky-note-text"]').last();
