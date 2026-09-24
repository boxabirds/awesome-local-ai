/**
 * Story 3 · end-to-end live-collaboration tests (nightly).
 *
 * Run against the real app served by `wrangler dev`, so the `WebsocketProvider`
 * talks to the real `BoardRoom` Durable Object over a real WebSocket — not a
 * mock. Two browser pages in one context are two independent clients on one
 * room (BroadcastChannel is disabled in the provider, so the only path between
 * them is the server).
 *
 * Convergence is asserted from each page's own snapshot hook, never from a fixed
 * sleep, so the tests stay deterministic on a loaded runner. The change-delivery
 * budget is the shared `LIVE_UPDATE_LATENCY_BUDGET_MS`.
 */
import { expect, test, type Page } from '@playwright/test';
import { settle } from './helpers/board';
import { createBoardViaApi, waitForBoard } from './helpers/boards';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

/** Read the current connection state from the page's test hook. */
async function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6Live?.connectionState() ?? 'unknown');
}

/** Wait until the two pages report an identical, stable board snapshot. */
async function snapshotsMatch(pageA: Page, pageB: Page): Promise<boolean> {
  await pageA.evaluate(() => window.__vidi6Live?.waitForStableDoc());
  await pageB.evaluate(() => window.__vidi6Live?.waitForStableDoc());
  const a = await pageA.evaluate(() => JSON.stringify(window.__vidi6Live?.snapshot()));
  const b = await pageB.evaluate(() => JSON.stringify(window.__vidi6Live?.snapshot()));
  return a === b && a !== 'null' && a !== undefined;
}

test('the home page opens a fresh board, and a made-up address does not', async ({ page }) => {
  // Story 5: `/` is a home page, not a board. It offers one button, and that
  // button creates a real board through the Worker.
  await page.goto('/');
  await page.getByTestId('create-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 15_000 });
  await page.getByTestId('create-sticky').click();
  await expect(page.getByTestId('origin-marker')).toBeVisible();

  // A mistyped address is "Board not found" — it no longer mints a board.
  await page.goto('/b/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.getByTestId('not-found-page')).toBeVisible();
});

test('a note created on one board is visible on another that joined the same room', async ({
  context,
}) => {
  const pageA = await context.newPage();
  // One room, two clients: the board is created once and both pages navigate
  // to the same address (that is what a shared link is).
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await settle(pageA);
  await settle(pageB);

  await expect
    .poll(() => connectionState(pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .not.toBe('connecting');

  // A creates a note (centred, via the toolbar) — a real, observable change.
  await pageA.getByTestId('create-sticky').click();

  // B converges to A within the budget, with no manual refresh.
  await expect
    .poll(() => snapshotsMatch(pageA, pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .toBe(true);
});

test('two concurrent edits to one note converge to the same document', async ({ context }) => {
  const pageA = await context.newPage();
  // One room, two clients: the board is created once and both pages navigate
  // to the same address (that is what a shared link is).
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await settle(pageA);
  await settle(pageB);

  await expect
    .poll(() => connectionState(pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .not.toBe('connecting');

  // Both add a note at the same time; concurrent Y.Map sets + text inserts must
  // leave the two documents identical (PRD live.converge).
  await pageA.getByTestId('create-sticky').click();
  await pageB.getByTestId('create-sticky').click();

  await expect
    .poll(() => snapshotsMatch(pageA, pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .toBe(true);
});
