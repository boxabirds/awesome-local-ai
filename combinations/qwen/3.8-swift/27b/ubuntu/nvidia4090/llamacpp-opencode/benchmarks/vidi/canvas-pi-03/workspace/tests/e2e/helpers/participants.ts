/**
 * Story 3 e2e helpers: multi-context live collaboration.
 *
 * Opens N isolated browser contexts on the same board, waits for each to reach
 * the `connected` state (fully synced), and provides small interaction helpers
 * plus a latency-budgeted poll wrapper.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from 'src/shared/config';
import { newBoardId } from 'src/shared/board-id';
import { getNotes, getNoteCenter } from './board';

export const BUDGET = LIVE_UPDATE_LATENCY_BUDGET_MS;

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * Open `count` isolated contexts on a fresh board and wait until each has
 * reached the `connected` state (handshake + initial sync complete).
 */
export async function openParticipants(browser: Browser, count: number): Promise<Participant[]> {
  const boardId = newBoardId();
  const out: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 15000 });
    // `connected` only after the first successful sync.
    await page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      null,
      { timeout: 15000 },
    );
    out.push({ context, page, boardId });
  }
  return out;
}

/** Wrap `expect.poll` with the live-update latency budget. */
export function within(budgetMs: number, getter: () => Promise<unknown>) {
  return expect.poll(getter, { timeout: budgetMs });
}

/** Assert `getter()` resolves to `expected` within the live-update budget. */
export async function expectWithin<T>(
  getter: () => Promise<T>,
  expected: T,
  budgetMs: number = BUDGET,
): Promise<void> {
  await expect.poll(getter, { timeout: budgetMs }).toBe(expected);
}

/** Create a note centred on screen point (x, y); optionally type text. */
export async function createNote(page: Page, x: number, y: number, text = ''): Promise<void> {
  await page.mouse.dblclick(x, y);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Drag the note with `noteId` by (dx, dy) screen pixels. */
export async function moveNote(page: Page, noteId: string, dx: number, dy: number): Promise<void> {
  const c = await getNoteCenter(page, noteId);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Select the note and pick a colour swatch. */
export async function recolorNote(page: Page, noteId: string, color: string): Promise<void> {
  const c = await getNoteCenter(page, noteId);
  await page.mouse.click(c.x, c.y);
  await page.getByTestId(`swatch-${color}`).click();
}

/** Select the note and delete it. */
export async function deleteNote(page: Page, noteId: string): Promise<void> {
  const c = await getNoteCenter(page, noteId);
  await page.mouse.click(c.x, c.y);
  await page.getByTestId('delete-note-button').click();
}

/**
 * Double-click a note to edit it and type `text` (appended at the caret).
 *
 * A realistic per-keystroke delay (~60 ms, within normal human typing speed)
 * lets remote characters merge between local keystrokes, which is the
 * concurrent-typing scenario the test exercises.
 */
export async function typeInNote(page: Page, noteId: string, text: string): Promise<void> {
  const c = await getNoteCenter(page, noteId);
  await page.mouse.dblclick(c.x, c.y);
  await page.keyboard.type(text, { delay: 60 });
  await page.keyboard.press('Escape');
}

/** Return the note with the given id, or undefined. */
export async function noteById(
  page: Page,
  noteId: string,
): Promise<{ id: string; x: number; y: number; color: string; text: string } | undefined> {
  const notes = await getNotes(page);
  return notes.find((n) => n.id === noteId);
}
