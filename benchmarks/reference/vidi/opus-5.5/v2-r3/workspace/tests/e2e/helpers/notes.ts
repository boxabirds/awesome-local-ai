import { expect, type Locator, type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';

export function notes(page: Page): Locator {
  return page.getByRole('group', { name: 'Sticky note' });
}

export function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Note text' });
}

export interface NoteState {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** All notes as stored in the board document (via the test hook). */
export async function noteStates(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    const objects = window.__vidi6!.doc.getMap('objects');
    const out: NoteState[] = [];
    objects.forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      out.push({
        id,
        x: m.get('x') as number,
        y: m.get('y') as number,
        z: m.get('z') as number,
        color: m.get('color') as string,
        text: String(m.get('text')),
      });
    });
    return out;
  });
}

export async function noteState(page: Page, id: string): Promise<NoteState> {
  const found = (await noteStates(page)).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} not in document`);
  return found;
}

export async function noteId(note: Locator): Promise<string> {
  const id = await note.getAttribute('data-note-id');
  if (!id) throw new Error('note has no id');
  return id;
}

export async function centre(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The sticky note element topmost at a screen point, if any. */
export async function noteIdAt(page: Page, p: Point): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId ?? null,
    p,
  );
}

/** Double-click empty board at `p`, returning the created note (in edit mode). */
export async function createByDoubleClick(page: Page, p: Point): Promise<Locator> {
  const before = await notes(page).count();
  await page.mouse.dblclick(p.x, p.y);
  await expect(notes(page)).toHaveCount(before + 1);
  await expect(editor(page)).toBeFocused();
  const id = await noteId(page.locator('[data-editing="true"]'));
  return page.locator(`[data-note-id="${id}"]`);
}
