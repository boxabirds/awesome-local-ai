/**
 * Story 9 · task 10 — end-to-end free-text workflows, run in Chromium, Firefox
 * and WebKit against the built app. These are the truths the design reserves for
 * e2e: a real Text-tool click places a box that really wraps, the keyboard
 * shortcut places text and not a sticky note, and the three-dot sequence never
 * spawns a second object. Geometry is read from the painted page.
 */
import { expect, test } from '@playwright/test';
import { openFreshBoard } from './helpers/boards';
import { LONG_TEXT } from '../fixtures/texts';
import { selectTextTool, settle, texts } from './helpers/text';

/** A single Text-tool click (down + up, no travel) at a board point. */
async function textClick(page: import('@playwright/test').Page, x: number, y: number) {
  await page.mouse.click(x, y);
  await settle(page);
}

async function stickyCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[data-testid^="note-"]').count();
}

test('click-to-place: Text tool + click wraps long text, never a second object', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await selectTextTool(page);
  await textClick(page, 500, 300);

  // A text object now exists and its editor has focus.
  let blocks = await texts(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].editing).toBe(true);
  await page.keyboard.type(LONG_TEXT);
  await settle(page);

  // Leave editing so the box renders read-mode text.
  await page.keyboard.press('Escape');
  await settle(page);
  blocks = await texts(page);

  // Exactly one object, committed (not editing).
  expect(blocks).toHaveLength(1);
  expect(blocks[0].editing).toBe(false);
  // Long text wrapped: the painted height is clearly more than one line and the
  // width stayed bounded to the wrap box (plus sub-pixel rounding).
  expect(blocks[0].height).toBeGreaterThan(80);
  expect(blocks[0].width).toBeLessThan(760);
  // The committed content survived the round trip into read mode.
  expect(blocks[0].text.length).toBeGreaterThan(200);
});

test('keyboard: T then a double-click makes a text object, not a sticky note', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  // Select the Text tool from the keyboard on an empty board.
  await page.keyboard.press('t');
  await settle(page);

  await page.mouse.dblclick(520, 320);
  await settle(page);

  // A text object was created and no sticky note was.
  const blocks = await texts(page);
  expect(blocks.length).toBeGreaterThanOrEqual(1);
  expect(await stickyCount(page)).toBe(0);
});

test('three-dot paste does not create a new object', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await selectTextTool(page);
  await textClick(page, 480, 300);
  // Type a sequence that contains three consecutive dots.
  await page.keyboard.type('...');
  await settle(page);

  // Exactly one object, still the one being edited.
  const blocks = await texts(page);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].editing).toBe(true);
});
