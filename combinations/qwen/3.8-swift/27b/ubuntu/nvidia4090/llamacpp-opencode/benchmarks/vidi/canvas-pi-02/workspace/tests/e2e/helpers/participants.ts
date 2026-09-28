// Live-collaboration e2e helpers (story 3): open N isolated browser contexts
// on the same /b/<boardId> and assert propagation within the live-update
// latency budget.

import { expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface StickyNoteInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

export interface Participant {
  page: Page;
  /** Closes the browser context (destroys the provider via page close). */
  dispose(): Promise<void>;
}

/** A fresh board id, exactly as the app generates one on /. */
export function newBoard(): string {
  return newBoardId();
}

/**
 * Opens `count` isolated browser contexts on `/b/<boardId>` and waits for
 * each one's provider to report `connected` (socket open and initial sync
 * complete). The app recentres the world origin on the viewport centre at
 * zoom 1 on load, so all participants share the same camera.
 */
export async function connectParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => typeof window.__vidi6 !== 'undefined');
    await expect
      .poll(async () => page.evaluate(() => window.__vidi6?.connectionState ?? null))
      .toBe('connected');
    participants.push({
      page,
      dispose: async () => {
        await context.close();
      },
    });
  }
  return participants;
}

export async function disposeAll(participants: Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.dispose()));
}

export function getNotes(page: Page): Promise<StickyNoteInfo[]> {
  return page.evaluate(() => window.__vidi6?.getStickyNotes() ?? []);
}

/** Sorted (by id) note list — order-independent board comparison. */
export async function sortedNotes(page: Page): Promise<StickyNoteInfo[]> {
  const notes = await getNotes(page);
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * expect.poll with the live-update latency budget (LIVE_UPDATE_LATENCY_BUDGET_MS)
 * as the default timeout: a change made by one participant must be visible
 * on another's screen within this window.
 */
export function expectWithin<T>(fn: () => Promise<T>, timeout: number = LIVE_UPDATE_LATENCY_BUDGET_MS) {
  return expect.poll(fn, { timeout });
}

/** The connection badge on a participant's page (hidden when connected).
 *  Targeted by its test id: getByRole('status') also matches the zoom label
 *  and the navigation hint, both of which are always present. */
export function badge(page: Page) {
  return page.getByTestId('connection-status');
}

/** The badge's text, or null while hidden. */
export async function badgeText(page: Page): Promise<string | null> {
  const loc = badge(page);
  return (await loc.count()) === 0 ? null : (await loc.textContent());
}

/** Collect console errors and page errors on a page. */
export function collectErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return () => errors;
}
