/**
 * Story 2 · task 8 — e2e helpers for the sticky-note workflows.
 *
 * As with the Story 1 helpers we do not reimplement the camera maths; we read
 * facts the page *shows*: each note's on-screen bounding box and its world
 * (x, y) stamped in the DOM, plus the computed font size. That keeps the tests
 * honest about what is actually rendered.
 */
import { expect, type Page } from '@playwright/test';

export interface NoteReadout {
  id: string;
  /** Bounding box in page/CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** World position from `data-x` / `data-y`. */
  wx: number;
  wy: number;
  /** Whether the note is in editing mode right now. */
  editing: boolean;
}

/** Every sticky note currently rendered, in paint order (bottom → top). */
export async function readNotes(page: Page): Promise<NoteReadout[]> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-note-id]')];
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const editor = node.querySelector('[data-testid="sticky-editor"]');
      return {
        id: node.dataset.noteId as string,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        wx: Number.parseFloat(node.dataset.x ?? 'NaN'),
        wy: Number.parseFloat(node.dataset.y ?? 'NaN'),
        editing: editor !== null,
      };
    });
  });
}

/** Wait for the rAF-batched camera / DOM to settle. */
export async function settle(page: Page, frames = 3): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(
      () => new Promise<null>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
    );
  }
}

/** Double-click empty board space to create a note and enter editing. */
export async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid="sticky-editor"]', { timeout: 3000 });
}

/** The note under a given screen point, or null. */
export async function noteAtPoint(page: Page, x: number, y: number): Promise<NoteReadout | null> {
  const notes = await readNotes(page);
  return notes.find((n) => x >= n.left && x <= n.left + n.width && y >= n.top && y <= n.top + n.height)
    ?? null;
}

/** Assert two single-axis deltas match to within a pixel tolerance. */
export function expectClose(actual: number, expected: number, tolerance = 1): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual.toFixed(2)} to be within ${tolerance}px of ${expected.toFixed(2)}`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * The id of the note painted topmost at a screen point (in paint order), or
 * null. `elementFromPoint` returns the top-most hit-testable element, and each
 * note subtree carries its `data-note-id` on the group root.
 */
export async function topNoteIdAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const group = el ? el.closest('[data-note-id]') : null;
      return group ? (group as HTMLElement).dataset.noteId ?? null : null;
    },
    [x, y],
  );
}

/** The rendered background colour of a note (for recolour checks). */
export async function backgroundColorOf(page: Page, id: string): Promise<string> {
  const el = page.locator(`[data-note-id="${id}"]`).first();
  return el.evaluate((node) => getComputedStyle(node).backgroundColor);
}

/** The computed font size of a note's text layer, in CSS pixels. */
export async function fontSizeOf(page: Page, id: string, mode: 'display' | 'editor'): Promise<number> {
  const selector =
    mode === 'display'
      ? `[data-note-id="${id}"] .sticky-display`
      : `[data-note-id="${id}"] .sticky-textarea`;
  return page
    .locator(selector)
    .first()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
}

/** The plain text currently shown in a note (read mode). */
export async function displayTextOf(page: Page, id: string): Promise<string> {
  return page
    .locator(`[data-note-id="${id}"] .sticky-display`)
    .first()
    .innerText();
}