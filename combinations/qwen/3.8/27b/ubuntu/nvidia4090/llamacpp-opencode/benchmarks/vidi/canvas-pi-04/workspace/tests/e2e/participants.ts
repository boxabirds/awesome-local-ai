// Story 3, task 8: E2E helper for multi-participant tests.
//
// A "participant" is a fresh browser context (isolated storage, cookies and
// cache) on the same browser — the closest thing to a second person on a
// second machine that e2e can get. Participants connect to the SAME board
// id, which is the entire collaboration model: the id IS the board.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
}

/**
 * Story 5: a board id is only a board once it has been created (POST
 * /api/boards); opening an unknown link shows "Board not found". Every e2e
 * that needs a real board therefore creates one first.
 *
 * Rate limiting is per visitor IP (share.rate_limit) and in `wrangler dev`
 * the visitor key falls back to the CF-Connecting-IP header, so each call
 * stamps a UNIQUE ip from a per-process range: tests never share a rate
 * bucket (and a retried test gets a fresh bucket, not a poisoned one).
 */
const RUN_NONCE = Math.floor(Math.random() * 0x10000);
let nextIp = 0;

/** A visitor ip unique to this test process + call (10.nonceA.nonceB.seq). */
export function uniqueVisitorIp(): string {
  nextIp = (nextIp + 1) & 0xff;
  return `10.${(RUN_NONCE >> 8) & 255}.${RUN_NONCE & 255}.${nextIp}`;
}

/** Create a real board via the API; resolves to its id. */
export async function newBoard(baseURL: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': uniqueVisitorIp() },
  });
  if (res.status !== 201) {
    throw new Error(
      `board creation failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { id: string };
  if (typeof data.id !== 'string') {
    throw new Error(`board creation returned no id: ${JSON.stringify(data)}`);
  }
  return data.id;
}

/** Wait until the page's board has first synced (badge state is "connected"). */
async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6?.connectionState?.() === 'connected',
    undefined,
    { timeout: 15_000, polling: 100 },
  );
}

/**
 * Open a participant on `boardId` and wait until their board is live
 * (connected + synced).
 */
export async function openParticipant(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await waitForConnected(page);
  return { context, page };
}

export async function closeParticipant(participant: Participant): Promise<void> {
  await participant.context.close();
}

/**
 * PRD live.latency: expect `poll()` to equal `expected` within the live
 * update latency budget (measured from the moment of the call, which the
 * tests make coincide with the sender's DOM update).
 */
export async function expectWithin<T>(
  poll: () => T | Promise<T>,
  expected: T,
  timeoutMs: number = LIVE_UPDATE_LATENCY_BUDGET_MS,
): Promise<void> {
  await expect.poll(poll, { timeout: timeoutMs }).toBe(expected);
}

/**
 * Reconnection is allowed to take up to the provider's max backoff plus the
 * live budget — used for the catch-up (flaky Wi-Fi) assertions.
 */
export const RECONNECT_SETTLE_MS = RECONNECT_MAX_BACKOFF_MS + LIVE_UPDATE_LATENCY_BUDGET_MS + 5_000;

/** The badge element (null-ish locator when hidden). */
export function badge(page: Page) {
  return page.locator('.connection-status');
}

/** Mapped connection state as exposed by the test hook. */
export async function connectionState(page: Page): Promise<string> {
  const state = await page.evaluate(
    () => (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6?.connectionState?.(),
  );
  return state ?? 'unknown';
}
