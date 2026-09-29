// E2E participants (spec: sync.client, tasks 8/9).
//
// Opens N isolated browser contexts on the SAME `/b/<boardId>` against the
// real `wrangler dev` server, so each is a genuine y-websocket client of the
// BoardRoom Durable Object. Helpers drive the real UI (toolbar, notes,
// colour swatches, editor) and assert delivery within the live-update budget.

import { APIRequestContext, Browser, BrowserContext, Locator, Page, expect } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { createBoardViaHook } from './board';

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * A fresh, content-free board, created via the test hook (story 5: opening a
 * board link requires the board to exist; the hook bypasses the rate
 * limiter so parallel specs don't exhaust the shared window).
 */
export async function createFreshBoard(request: APIRequestContext): Promise<string> {
  return createBoardViaHook(request);
}

/**
 * Open a new isolated context on the board and wait until its provider has
 * connected (the mapped state is `connected` and the badge is hidden).
 */
export async function openParticipant(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => window.__vidi6 !== undefined && window.__vidi6.connectionState === 'connected',
    { timeout: 30_000 },
  );
  return { context, page, boardId };
}

/**
 * Poll an assertion until it holds, bounded by the live-update latency budget
 * (spec: assertion timeout equals LIVE_UPDATE_LATENCY_BUDGET_MS exactly).
 */
export async function expectWithin<T>(
  fn: () => Promise<T> | T,
  options?: { timeout?: number; message?: string },
): Promise<void> {
  await expect.poll(fn, {
    timeout: options?.timeout ?? LIVE_UPDATE_LATENCY_BUDGET_MS,
    message: options?.message,
    intervals: [20],
  }).toBeTruthy();
}

export async function closeParticipant(p: Participant): Promise<void> {
  await p.context.close();
}

// ---------------------------------------------------------------------------
// UI helpers (drive the real board)
// ---------------------------------------------------------------------------

/** All sticky notes on the page. */
export function notes(page: Page): Locator {
  return page.locator('[data-testid="sticky-note"]');
}

export async function noteCount(page: Page): Promise<number> {
  return notes(page).count();
}

/** The visible text of every note, in DOM order. */
export async function noteTexts(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="sticky-note"] [data-testid="sticky-text"]')
    .allTextContents();
}

/** Create a note via the sticky tool (story 10: the button activates the
tool; a click on the board centre creates the note and starts editing). */
export async function createNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.mouse.click(640, 400);
}

/** Select a note by index (a plain click selects without editing). */
export async function selectNote(page: Page, index: number): Promise<void> {
  await notes(page).nth(index).click();
}

/** Delete the currently selected note via the keyboard shortcut. */
export async function deleteSelected(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
}

/**
 * Drag the note at `index` by (dx, dy) screen pixels. The drag uses the real
 * pointer pipeline (down / move / up) so the board-model move is applied.
 */
export async function dragNote(
  page: Page,
  index: number,
  dx: number,
  dy: number,
): Promise<void> {
  const box = (await notes(page).nth(index).boundingBox()) ?? undefined;
  if (box === undefined) throw new Error('note has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // A few stepped moves so the drag crosses the threshold and is recognised.
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

/** Change the selected note's colour by clicking a colour swatch. */
export async function setNoteColor(page: Page, colorName: string): Promise<void> {
  await page
    .getByRole('button', { name: `${cap(colorName)} colour` })
    .click();
}

/** Start editing the note at `index` (double-click) and type `text`. */
export async function typeInNote(page: Page, index: number, text: string): Promise<void> {
  await notes(page).nth(index).dblclick();
  await page.locator('[data-testid="sticky-editor"] textarea').pressSequentially(text, {
    delay: 10,
  });
  // Commit the edit (pointerdown outside the note ends editing).
  await page.mouse.click(10, 10);
}

/** The selected note's background colour (rgb string), for assertions. */
export async function noteColor(page: Page, index: number): Promise<string> {
  return (
    await notes(page)
      .nth(index)
      .evaluate((el) => getComputedStyle(el).backgroundColor)
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
