import type { Locator, Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';

/**
 * Story 2 e2e helpers: read the board model through the test-only
 * `window.__vidi6.getBoard` hook (test builds only) and drive sticky notes.
 */

export async function getBoard(page: Page): Promise<StickySnapshot[]> {
  await page.waitForFunction(() => typeof (window as any).__vidi6?.getBoard === 'function');
  return (await page.evaluate(() => (window as any).__vidi6.getBoard())) as StickySnapshot[];
}

export function notes(page: Page): Locator {
  return page.locator('[data-sticky-note]');
}

export function note(page: Page, index = 0): Locator {
  return notes(page).nth(index);
}

export function editor(page: Page): Locator {
  return page.locator('[data-sticky-textarea]');
}

export function noteToolbar(page: Page): Locator {
  return page.locator('[data-note-toolbar]');
}

export async function boxOf(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
}> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no bounding box');
  return {
    ...box,
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    right: box.x + box.width,
    bottom: box.y + box.height,
  };
}

/** Press the left toolbar's Sticky note button. */
export async function createStickyByButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await editor(page).waitFor({ state: 'visible' });
}

/** Leave editing mode, leaving the note selected. */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await editor(page).waitFor({ state: 'hidden' });
}

/** Drag whatever is under `(x, y)` by `(dx, dy)` screen pixels. */
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Caret position and length of the open editor. */
export async function editorCaret(page: Page): Promise<{ start: number; length: number }> {
  return editor(page).evaluate((el) => ({
    start: (el as HTMLTextAreaElement).selectionStart ?? 0,
    length: (el as HTMLTextAreaElement).value.length,
  }));
}

/** The camera that puts world (0,0) in the middle of a 1280x800 viewport. */
export function centredCamera(zoom: number): { x: number; y: number; zoom: number } {
  return { x: -640 / zoom, y: -400 / zoom, zoom };
}
