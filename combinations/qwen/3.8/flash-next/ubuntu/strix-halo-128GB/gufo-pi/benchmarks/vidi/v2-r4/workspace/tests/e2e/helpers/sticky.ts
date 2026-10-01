import { expect, type Locator, type Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NoteState {
  id: string;
  box: Box;
  world: { x: number; y: number };
  z: number;
  text: string;
  color?: string;
  selected?: string;
}

export function notes(page: Page): Locator {
  return page.getByTestId('sticky-note');
}

/** A note located by its id (survives z-order changes). */
export function noteById(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);
}

export function noteAt(page: Page, index = 0): Locator {
  return notes(page).nth(index);
}

/** A note located by the text it holds (z-order re-sorts the DOM). */
export function noteWithText(page: Page, text: string): Locator {
  return notes(page).filter({ hasText: text });
}

export function noteText(page: Page, index = 0): Locator {
  return page.getByTestId('sticky-note-text').nth(index);
}

export function editor(page: Page): Locator {
  return page.getByTestId('sticky-textarea');
}

export function createStickyButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Sticky note' });
}

export function swatch(page: Page, colour: string): Locator {
  return page.getByRole('button', { name: `${colour} colour` });
}

export function deleteNoteButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Delete note' });
}

/** A note's screen box plus the world coordinates it was drawn from. */
export async function stateOf(target: Locator): Promise<NoteState> {
  const box = await target.boundingBox();
  if (!box) throw new Error('note is not visible');
  const data = await target.evaluate((el) => {
    const html = el as HTMLElement;
    return {
      world: { x: Number(html.dataset.worldX), y: Number(html.dataset.worldY) },
      z: Number(html.dataset.z),
      id: html.dataset.noteId ?? '',
      text: html.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '',
      color: html.dataset.color,
      selected: html.dataset.selected,
    };
  });
  return { box, ...data };
}

/** Double-click empty board space and wait for the note to open for typing. */
export async function doubleClickToCreate(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await expect(editor(page)).toBeVisible();
}

/** Drag a note from a point inside it by a screen delta, following the pointer. */
export async function dragNoteBy(
  target: Locator,
  grab: { x: number; y: number },
  delta: { x: number; y: number },
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('note is not visible');
  const from = { x: box.x + grab.x, y: box.y + grab.y };
  await target.page().mouse.move(from.x, from.y);
  await target.page().mouse.down();
  await target.page().mouse.move(from.x + delta.x, from.y + delta.y, { steps: 10 });
  await target.page().mouse.up();
  await target.page().waitForTimeout(50);
}

/** Type into the active editor character by character. */
export async function typeText(page: Page, text: string): Promise<void> {
  await editor(page).pressSequentially(text, { delay: 5 });
  await page.waitForTimeout(50);
}

/** Click empty board space to end editing and clear the selection. */
export async function clickEmptyBoard(page: Page, at = { x: 80, y: 720 }): Promise<void> {
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(50);
}

/** The computed font size of a note's text, in pixels. */
export async function noteFontSize(page: Page, index = 0): Promise<number> {
  return noteText(page, index).evaluate((el) =>
    Number(window.getComputedStyle(el as HTMLElement).fontSize.replace('px', '')),
  );
}

/**
 * True when the text is clipped inside the note: hidden overflow, content
 * taller than the box (so something *would* spill) and the painted box still
 * inside the note.
 */
export async function textIsClippedInsideNote(page: Page, index = 0): Promise<boolean> {
  return noteText(page, index).evaluate((textEl) => {
    const el = textEl as HTMLElement;
    const noteEl = el.closest('[data-testid="sticky-note"]') as HTMLElement;
    const inner = noteEl.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const hidden = style.overflow === 'hidden' || style.overflowY === 'hidden';
    return (
      hidden &&
      el.scrollHeight >= el.clientHeight &&
      own.bottom <= inner.bottom + 1 &&
      own.right <= inner.right + 1
    );
  });
}

/** The world position and stacking of the top-most note under a screen point. */
export async function topmostNoteAt(
  page: Page,
  point: { x: number; y: number },
): Promise<{ x: number; z: number } | null> {
  return page.evaluate(({ x, y }) => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest('[data-testid="sticky-note"]') as HTMLElement | null;
    if (!el) return null;
    return { x: Number(el.dataset.worldX), z: Number(el.dataset.z) };
  }, point);
}
