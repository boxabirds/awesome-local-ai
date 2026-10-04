import { type Page, type BrowserContext } from '@playwright/test';

// Inline constants (Playwright tests can't import from src/)
const LIVE_UPDATE_LATENCY_BUDGET_MS = 500;

function newBoardId(): string {
  // Generate 22 random base64url characters (matches BOARD_ID_PATTERN)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 22; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

export const E2E_EVENTUAL_TIMEOUT_MS = 15000;

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * Open a new browser context on the given board ID.
 */
export async function openParticipant(
  browser: import('@playwright/test').Browser,
  baseURL: string,
  boardId: string,
): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/b/${boardId}`);
  // Wait for the board to be ready (the viewport is present once the app mounts)
  await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  return { context, page, boardId };
}

/**
 * Open N participants on the same board.
 */
export async function openParticipants(
  browser: import('@playwright/test').Browser,
  baseURL: string,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < count; i++) {
    participants.push(await openParticipant(browser, baseURL, boardId));
  }
  // Wait a bit for all participants to sync
  await new Promise(r => setTimeout(r, 1000));
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
 * expectEventually: poll until the condition is met or timeout.
 * Logs the time it took against LIVE_UPDATE_LATENCY_BUDGET_MS.
 */
export async function expectEventually(
  fn: () => Promise<boolean>,
  description: string,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (await fn()) {
      const elapsed = Date.now() - start;
      const status = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? '✓' : '⚠ (over budget)';
      console.log(`  ${status} ${description}: ${elapsed}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for: ${description} (${timeoutMs}ms)`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * Create a new board and return its ID.
 */
export function createBoardId(): string {
  return newBoardId();
}
