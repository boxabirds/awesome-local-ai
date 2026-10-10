import { expect, type Locator, type Page } from '@playwright/test';

import type { Point } from './board';

/** One rendered note, read from its data attributes. */
export interface NoteData {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly selected: boolean;
  readonly overflow: boolean;
}

/** All notes in render order (the snapshot is sorted by z, then id). */
export function notes(page: Page): Locator {
  return page.locator('.sticky-note');
}

export function readNotes(page: Page): Promise<NoteData[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.sticky-note')).map((element) => {
      const data = element.dataset;
      return {
        id: data.noteId ?? '',
        x: Number(data.x),
        y: Number(data.y),
        z: Number(data.z),
        width: Number(data.width),
        height: Number(data.height),
        color: data.color ?? '',
        selected: data.selected === 'true',
        overflow: data.overflow === 'true',
      };
    }),
  );
}

/**
 * The text of every note, in render order. While a note is being edited its
 * text is in the editor, so that is read too: two screens of one board show the
 * same characters whatever each of them is doing.
 */
export function noteTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.sticky-note')).map((element) => {
      const editor = element.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]');
      if (editor) return editor.value;
      return element.querySelector('.sticky-text')?.textContent ?? '';
    }),
  );
}

export async function expectNoteCount(page: Page, count: number): Promise<void> {
  await expect(notes(page)).toHaveCount(count);
}

/**
 * Poll until note `index` matches the given fields. Coordinates tolerate half
 * a pixel; frames only ever settle below that (sticky.move).
 */
export async function expectNote(
  page: Page,
  index: number,
  expected: Partial<
    Pick<NoteData, 'x' | 'y' | 'z' | 'color' | 'selected' | 'overflow'>
  >,
): Promise<void> {
  await expect
    .poll(async () => {
      const all = await readNotes(page);
      const note = all[index];
      if (!note) return 'note is missing';
      const problems: string[] = [];
      if (expected.x !== undefined && Math.abs(note.x - expected.x) > 0.5) {
        problems.push(`x=${note.x}`);
      }
      if (expected.y !== undefined && Math.abs(note.y - expected.y) > 0.5) {
        problems.push(`y=${note.y}`);
      }
      if (expected.z !== undefined && note.z !== expected.z) problems.push(`z=${note.z}`);
      if (expected.color !== undefined && note.color !== expected.color) {
        problems.push(`color=${note.color}`);
      }
      if (expected.selected !== undefined && note.selected !== expected.selected) {
        problems.push(`selected=${note.selected}`);
      }
      if (expected.overflow !== undefined && note.overflow !== expected.overflow) {
        problems.push(`overflow=${note.overflow}`);
      }
      return problems.length === 0 ? 'ok' : problems.join(', ');
    })
    .toBe('ok');
}

export function noteTestIdLocators(page: Page, index: number): { text: Locator; fade: Locator } {
  const note = notes(page).nth(index);
  return { text: note.getByTestId('sticky-text'), fade: note.getByTestId('text-fade') };
}

export function textarea(page: Page): Locator {
  return page.getByTestId('sticky-textarea');
}

export async function noteCentre(page: Page, index: number): Promise<Point> {
  const box = await notes(page).nth(index).boundingBox();
  if (!box) throw new Error(`no bounding box for note ${index}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press, move and release from a point (used on notes and empty board). */
export async function dragFrom(
  page: Page,
  from: Point,
  to: Point,
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/**
 * A drag with an action inserted between the two move halves — the press is
 * still down while `mid` runs, so e.g. the note gets deleted underneath it.
 */
export async function dragWithStep(
  page: Page,
  from: Point,
  to: Point,
  mid: () => Promise<void>,
): Promise<void> {
  const half = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(half.x, half.y, { steps: 6 });
  await mid();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Delete a note through the test hook, as another client would. */
export async function deleteNoteBehind(page: Page, index: number): Promise<void> {
  const all = await readNotes(page);
  const id = all[index]?.id;
  if (!id) throw new Error(`no note at index ${index}`);
  await page.evaluate((noteId) => window.__vidi6Board?.deleteNote(noteId), id);
}

/** A double-click on the given point of the board. */
export function dblClick(page: Page, at: Point): Promise<void> {
  return page.mouse.dblclick(at.x, at.y);
}
