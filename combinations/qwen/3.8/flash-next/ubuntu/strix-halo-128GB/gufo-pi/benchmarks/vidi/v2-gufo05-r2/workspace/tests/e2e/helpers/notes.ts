import { expect, type Page } from '@playwright/test';

import type { StickySnapshot } from '../../../src/shared/board-model';
import { expectNoPendingCameraFrame, type Pixel } from './board';

export interface NoteBox extends Pixel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

/** The live note snapshots (sorted by z, id). */
export async function getNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as { __vidi6?: { getNotes?(): StickySnapshot[] } }
    ).__vidi6;
    if (!hooks?.getNotes) {
      throw new Error('window.__vidi6.getNotes missing: e2e needs a test build');
    }
    return hooks.getNotes();
  });
}

/** Screen boxes of every rendered note, keyed by id. */
export async function noteBoxes(page: Page): Promise<Record<string, NoteBox>> {
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.noteId as string,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  const boxes: Record<string, NoteBox> = {};
  for (const r of raw) {
    boxes[r.id] = { ...r, right: r.x + r.width, bottom: r.y + r.height };
  }
  return boxes;
}

/**
 * Double-click empty board space and return the id of the note that appears.
 * The diff against the ids present before guarantees we grab the new note even
 * when several already exist.
 */
export async function createNoteByDblClick(page: Page, at: Pixel): Promise<string> {
  const before = new Set((await getNotes(page)).map((n) => n.id));
  await page.mouse.dblclick(at.x, at.y);
  await expectNoPendingCameraFrame(page);
  const created = (await getNotes(page)).filter((n) => !before.has(n.id));
  if (created.length !== 1) {
    throw new Error(`expected one new note, saw ${created.length}`);
  }
  const note = created[0]!;
  // Editing starts automatically, so the note's textarea is focused.
  await expect(page.locator(`[data-note-id="${note.id}"] textarea`)).toBeVisible();
  return note.id;
}

/** Type into the focused note editor. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

/** End editing with Escape (keeps the note selected). */
export async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expectNoPendingCameraFrame(page);
}

/** Drag the note editor's textarea content by replacing its value (paste sim). */
export async function pasteIntoEditor(page: Page, id: string, text: string): Promise<void> {
  await page.locator(`[data-note-id="${id}"] textarea`).evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await expectNoPendingCameraFrame(page);
}

/** Real mouse drag from one screen point to another. */
export async function dragPointer(
  page: Page,
  from: Pixel,
  to: Pixel,
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}

/** A point inside `a` but outside `b` (for grabbing one of two overlapping notes). */
export function exposedPoint(a: NoteBox, b: NoteBox): Pixel {
  const candidates: Pixel[] = [
    { x: a.x + 12, y: a.y + 12 },
    { x: a.x + 12, y: a.bottom - 12 },
    { x: a.right - 12, y: a.y + 12 },
    { x: a.right - 12, y: a.bottom - 12 },
    { x: a.x + a.width / 2, y: a.y + 12 },
  ];
  for (const p of candidates) {
    const insideB = p.x >= b.x && p.x <= b.right && p.y >= b.y && p.y <= b.bottom;
    if (!insideB) return p;
  }
  return candidates[0]!;
}
