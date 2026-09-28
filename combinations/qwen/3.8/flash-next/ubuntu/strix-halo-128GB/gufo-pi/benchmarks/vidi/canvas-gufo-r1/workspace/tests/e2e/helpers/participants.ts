import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
}

/** Generate a board ID in the test context (using client-side crypto). */
export function makeBoardId(): string {
  // Generate a base64url string of 22 chars (matches BOARD_ID_PATTERN)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Open N isolated browser contexts on the same /b/<boardId>. */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    // Wait for the board viewport to be visible (connected and synced)
    await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();
    participants.push({ context, page });
  }
  return participants;
}

/** Close all participant contexts. */
export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) {
    await p.context.close();
  }
}

/** Assert a condition within the live update latency budget. */
export function expectWithin(
  _budgetMs: number = LIVE_UPDATE_LATENCY_BUDGET_MS,
): { timeout: number } {
  return { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS };
}

/** Wait for a note to be visible on a page. */
export function noteSelector(id: string): string {
  return `[data-testid="sticky-note"][data-note-id="${id}"]`;
}

/** Count notes on a page. */
export function noteCountSelector(): string {
  return '[data-testid^="sticky-note-"]';
}
