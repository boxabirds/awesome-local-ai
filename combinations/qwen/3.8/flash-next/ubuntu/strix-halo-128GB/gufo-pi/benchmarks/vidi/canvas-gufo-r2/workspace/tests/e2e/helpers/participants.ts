/**
 * E2E helpers for multi-participant live collaboration tests.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * Open N isolated browser contexts on the same /b/<boardId>, wait for sync.
 */
export async function openParticipants(
  browser: Browser,
  count: number,
  boardId: string,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    // Wait for the board to be ready (connected)
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => window.__vidi6?.connectionState);
          return state === 'connected';
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    participants.push({ context, page, boardId });
  }
  return participants;
}

/**
 * Close all participants.
 */
export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) {
    await p.context.close();
  }
}

/**
 * Assert a condition within the LIVE_UPDATE_LATENCY_BUDGET_MS.
 */
export function expectWithinBudget(
  fn: () => Promise<unknown>,
  _expected: unknown,
  timeout = LIVE_UPDATE_LATENCY_BUDGET_MS,
) {
  return expect.poll(fn, { timeout });
}

/**
 * Create a sticky note on a page by double-clicking at coordinates.
 * Returns the note id.
 */
export async function createNote(page: Page, x = 640, y = 400): Promise<string> {
  await page.dblclick('[data-testid="board"]', { position: { x, y } });
  // Wait for editor to appear (textarea is rendered)
  await page.waitForSelector('.sticky-textarea', { timeout: 3000 });
  // Get the note id from the data-note-id attribute
  const noteId = await page.evaluate(() => {
    const note = document.querySelector('[data-note-id]');
    return note?.getAttribute('data-note-id') ?? '';
  });
  return noteId;
}

/**
 * Count notes visible on a page.
 */
export async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-note-id]').count();
}

/**
 * Get all note IDs on a page.
 */
export async function noteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-note-id]', (els) =>
    els.map((el) => el.getAttribute('data-note-id')!),
  );
}

/**
 * End editing by pressing Escape.
 */
export async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}
