// Helpers for multi-participant e2e tests: open browsers on the same board,
// create/move notes, read the badge state and snapshot the board.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * Open a fresh board in a new browser context. The app replaces the address
 * with `/b/<boardId>` on load; we read that id from the test hook.
 */
export async function openParticipant(browser: Browser): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('app-root').waitFor();
  const boardId = await page.evaluate(() => window.__vidi6?.getBoardId() ?? '');
  expect(boardId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return { context, page, boardId };
}

/** Navigate a page to an existing board. */
export async function joinBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('app-root').waitFor();
}

export async function closeParticipant(p: Participant): Promise<void> {
  await p.context.close();
}

export function noteLocator(page: Page) {
  return page.locator('[data-testid="sticky-note"]');
}

export async function notesCount(page: Page): Promise<number> {
  return noteLocator(page).count();
}

/** Poll until the note count equals `n` (eventual delivery). */
export async function waitForNotes(page: Page, n: number): Promise<void> {
  await expect
    .poll(() => notesCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(n);
}

/** Create an empty note by double-clicking at screen (x, y). */
export async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await noteLocator(page).last().waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
}

/** Create a note with text at screen (x, y). */
export async function createNoteWithText(
  page: Page,
  text: string,
  x = 400,
  y = 300,
): Promise<void> {
  await page.mouse.dblclick(x, y);
  await noteLocator(page).last().waitFor({ timeout: 5000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Select the first note and start editing it. */
export async function startEditingFirstNote(page: Page): Promise<void> {
  const note = noteLocator(page).first();
  const box = (await note.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Enter');
  await page.locator('.sticky-text-editor__textarea').waitFor();
}

/** The display texts of all notes, in DOM order. */
export async function noteTexts(page: Page): Promise<string[]> {
  return page.locator('.sticky-note__text').allTextContents();
}

/** Connection state badge value (test hook). */
export async function badgeState(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6?.getConnectionState() ?? '');
}

/** Poll until the badge reaches `state`. */
export async function waitForBadge(page: Page, state: string): Promise<void> {
  await expect
    .poll(() => badgeState(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(state);
}

/**
 * Board snapshot: each note's text and screen position, sorted so two pages
 * can be compared for identical end state.
 */
export async function notesSnapshot(
  page: Page,
): Promise<{ text: string; x: number; y: number }[]> {
  const boxes = await noteLocator(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
  );
  const texts = await page.locator('.sticky-note__text').allTextContents();
  return boxes
    .map((b, i) => ({ text: texts[i] ?? '', x: Math.round(b.x), y: Math.round(b.y) }))
    .sort((a, b) => a.text.localeCompare(b.text) || a.x - b.x);
}

export async function setOffline(context: BrowserContext, offline: boolean): Promise<void> {
  await context.setOffline(offline);
}
