import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardId: string;
}

/**
 * Opens N isolated browser contexts on the same /b/<boardId>.
 * Each participant gets a fresh context (separate from others).
 */
export async function createParticipants(
  browser: Browser,
  count: number,
  baseURL: string
): Promise<Participant[]> {
  const boardId = newBoardId();
  const participants: Participant[] = [];

  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseURL}/b/${boardId}`);
    // Wait for the board to be ready (connection established)
    await page.waitForFunction(() => {
      return (window as any).__vidi6?.connectionState === 'connected';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    participants.push({ context, page, boardId });
  }

  return participants;
}

/**
 * expectEventually: wraps expect.poll with a generous functional timeout.
 * Also records how long the condition took and logs it against the latency budget.
 */
export async function expectEventually(
  fn: () => Promise<unknown>,
  description: string,
  timeoutMs: number = E2E_EVENTUAL_TIMEOUT_MS
): Promise<void> {
  const start = Date.now();
  await expect.poll(fn, { timeout: timeoutMs }).toBeTruthy();
  const elapsed = Date.now() - start;
  const status = elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS ? '⚠️ EXCEEDS' : '✓ within';
  console.log(`  [latency] ${description}: ${elapsed}ms (${status} ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`);
}

/**
 * Gets the board snapshot from a page.
 */
export async function getBoardSnapshot(page: Page): Promise<readonly {
  id: string; type: string; x: number; y: number; color: string; text: string; z: number; createdAt: number;
}[]> {
  return page.evaluate(() => {
    return (window as any).__vidi6?.snapshot?.() ?? [];
  });
}

/**
 * Compares two board snapshots for structural equality (ignoring order).
 */
export function snapshotsEqual(
  a: readonly { id: string; x: number; y: number; color: string; text: string }[],
  b: readonly { id: string; x: number; y: number; color: string; text: string }[]
): boolean {
  if (a.length !== b.length) return false;
  const key = (n: { id: string; x: number; y: number; color: string; text: string }) =>
    `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}|${n.color}|${n.text}`;
  const aKeys = a.map(key).sort();
  const bKeys = b.map(key).sort();
  return JSON.stringify(aKeys) === JSON.stringify(bKeys);
}
