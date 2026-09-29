import { expect, type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { settle } from './board';

export async function notes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6!.notes?.() ?? [])]);
}

export function noteById(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

export async function noteBox(page: Page, id: string) {
  const box = await noteById(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} not rendered`);
  return box;
}

export async function centreOf(page: Page, id: string): Promise<Point> {
  const b = await noteBox(page, id);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Double-clicks empty board space and returns the id of the note it created. */
export async function createByDoubleClick(page: Page, at: Point): Promise<string> {
  const before = new Set((await notes(page)).map((n) => n.id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  const created = (await notes(page)).filter((n) => !before.has(n.id));
  expect(created).toHaveLength(1);
  return created[0].id;
}

/** Real mouse drag in several steps, then waits for the frame that applies it. */
export async function dragBy(page: Page, from: Point, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 3, from.y + dy / 3, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** The id of the note drawn topmost at a screen point, or null. */
export async function noteAt(page: Page, p: Point): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId ?? null,
    p,
  );
}
