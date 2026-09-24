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

/** Read the current board URL, waiting for the `/b/<id>` rewrite. */
async function boardUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 15_000 });
  return page.url();
}

test('the home route redirects to a fresh, valid board and stays interactive', async ({
  page,
}) => {
  await page.goto('/');
  // `/` mints a board id and rewrites the address (temporary routing, story 3).
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 15_000 });
  // A board with no server yet must not lock the canvas: creating a note works
  // regardless of the badge (TC-21 — "the badge never blocks the board").
  await page.getByTestId('create-sticky').click();
  await expect(page.getByTestId('origin-marker')).toBeVisible();
});

test('a note created on one board is visible on another that joined the same room', async ({
  context,
}) => {
  const pageA = await context.newPage();
  await pageA.goto('/');
  const url = await boardUrl(pageA);
  const urlB = new URL(url);
  const pageB = await context.newPage();
  await pageB.goto(urlB.toString());
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
  await pageA.goto('/');
  const url = await boardUrl(pageA);
  const urlB = new URL(url);
  const pageB = await context.newPage();
  await pageB.goto(urlB.toString());
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
