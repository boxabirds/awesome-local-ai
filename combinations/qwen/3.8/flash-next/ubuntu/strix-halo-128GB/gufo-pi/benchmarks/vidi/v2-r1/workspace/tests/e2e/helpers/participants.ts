/**
 * Shared helpers for multi-participant e2e collaboration tests.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
  /** Unique name for logging. */
  name: string;
}

/**
 * Open N isolated browser contexts on the same board URL.
 * Each context is fully isolated (no shared cookies/storage/BroadcastChannel).
 * Waits for the viewport and the test hook to be ready on each page.
 * If boardId is not provided, creates a new board via the API.
 */
export async function openParticipants(
  browser: Browser,
  count: number,
  boardId?: string,
): Promise<Participant[]> {
  // Create a board if not provided (POST /api/boards)
  let id = boardId;
  if (!id) {
    const tmpContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const tmpPage = await tmpContext.newPage();
    await tmpPage.goto('/');
    id = await tmpPage.evaluate(async () => {
      const res = await fetch('/api/boards', { method: 'POST' });
      const body = await res.json();
      return body.id as string;
    });
    await tmpContext.close();
  }
  const participants: Participant[] = [];

  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('viewport')).toBeVisible({ timeout: 15_000 });
    // Wait for the test hook to be installed (indicates the board is fully loaded)
    await expect
      .poll(() => page.evaluate(() => typeof window.__vidi6?.getCamera === 'function'), {
        timeout: 10_000,
      })
      .toBe(true);
    participants.push({ context, page, name: `P${i}` });
  }

  // Wait for all participants to be synced (connection status should not show
  // "Connecting…" after a short grace period)
  await Promise.all(
    participants.map(async (p) => {
      await expect
        .poll(
          async () => {
            const state = await p.page.evaluate(() =>
              document.querySelector('[role="status"]')?.textContent ?? null,
            );
            return state === null; // hidden = connected
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }),
  );

  return participants;
}

/**
 * Open a specific board by id (join flow for E2E share tests).
 */
export async function joinBoard(browser: Browser, boardId: string): Promise<Participant> {
  const [p] = await openParticipants(browser, 1, boardId);
  return p;
}

/**
 * Close all participant contexts.
 */
export async function closeParticipants(participants: Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

/**
 * Wait until a condition is met on a page, with generous timeout and latency logging.
 * The latency budget is reported (logged), not asserted, because model, browsers
 * and server share one machine.
 */
export async function expectEventually(
  _label: string,
  _participants: Participant[],
  fn: () => Promise<boolean>,
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  await expect
    .poll(fn, { timeout, message: `${_label} (elapsed: ${Date.now() - start}ms)` })
    .toBe(true);
  const elapsed = Date.now() - start;
  if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS) {
    console.log(
      `[latency] ${_label}: ${elapsed}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms — EXCEEDED, not asserted)`,
    );
  } else {
    console.log(`[latency] ${_label}: ${elapsed}ms (within budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
  }
}

/**
 * Get the note count from a page (reads DOM).
 */
export async function noteCount(page: Page): Promise<number> {
  return page.locator('.sticky-note').count();
}

/**
 * Get all note ids from a page.
 */
export async function noteIds(page: Page): Promise<string[]> {
  return page.$$eval('.sticky-note', (els) =>
    els.map((el) => (el as HTMLElement).dataset.noteId ?? ''),
  );
}

/**
 * Create a sticky note via the toolbar button on a participant's page.
 * Returns the id of the created note.
 */
export async function createNoteAndGetId(p: Participant): Promise<string> {
  const before = await noteIds(p.page);
  await p.page.getByRole('button', { name: 'Sticky note', exact: true }).click();
  // Wait for the note to appear
  await expect
    .poll(() => noteCount(p.page), { timeout: 5000 })
    .toBeGreaterThan(before.length);
  // Dismiss editor
  await p.page.keyboard.press('Escape');
  await p.page.waitForTimeout(50);
  const after = await noteIds(p.page);
  const newIds = after.filter((id) => !before.includes(id));
  return newIds[0] ?? '';
}

/**
 * Get note data from the Y.Doc via the test hook.
 */
export async function getDocSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) return {};
    const objects = doc.getMap('objects');
    const result: Record<string, unknown> = {};
    for (const [key, value] of objects) {
      const ymap = value as { get(k: string): unknown; toJSON?(): unknown } | undefined;
      if (ymap && typeof ymap.get === 'function') {
        const entry: Record<string, unknown> = {};
        const keys = ['type', 'x', 'y', 'color', 'z'];
        for (const k of keys) {
          const v = ymap.get(k);
          if (v !== undefined) entry[k] = v;
        }
        // Text is a Y.Text; get its string
        const textYMap = ymap.get('text') as { toString?(): string } | undefined;
        if (textYMap && typeof textYMap.toString === 'function') {
          entry['text'] = textYMap.toString();
        }
        result[key] = entry;
      }
    }
    return result;
  });
}
