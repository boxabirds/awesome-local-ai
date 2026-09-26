import { test, expect, type Page } from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS } from '../../src/shared/config';
import {
  expectConnected,
  joinBoard,
  startBoard,
  viewportOf,
} from './helpers/live';

/**
 * Story 5 e2e: Create → Share → Open → same board.
 *
 * These tests exercise the full create/share/navigate flow across two
 * browser contexts. Board ids are minted client-side for most tests; the
 * rate-limited test drives the real Create flow.
 */

function getBoardId(page: Page): string {
  const match = page.url().match(/\/b\/([A-Za-z0-9_-]{22})/);
  if (!match) throw new Error(`no board id in ${page.url()}`);
  return match[1];
}

test('TC-26: Create → Share → Open → same board → live edit', async ({ browser }) => {
  // Maya: create board, add note, copy link
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await contextA.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:8787',
  });

  await pageA.goto('/');
  await expect(pageA.getByRole('button', { name: 'Create a board' })).toBeVisible();

  const createStart = Date.now();
  await pageA.getByRole('button', { name: 'Create a board' }).click();
  await pageA.waitForFunction(
    () => /^\/b\/[A-Za-z0-9_-]{22}$/.test(window.location.pathname),
    { timeout: 10_000 },
  );
  const createElapsed = Date.now() - createStart;
  expect(createElapsed).toBeLessThan(CREATE_BUDGET_MS);

  await expect(viewportOf(pageA)).toBeVisible();
  await expectConnected(pageA);
  const id = getBoardId(pageA);

  // Add a note on Maya's board
  await pageA.getByTestId('create-sticky').click();
  await expect(pageA.locator('[data-note-id]')).toHaveCount(1);

  // Copy link via Share → Copy link
  await pageA.getByRole('button', { name: 'Share' }).click();
  await pageA.getByRole('button', { name: 'Copy link' }).click();
  await expect(pageA.getByText('Link copied')).toBeVisible();
  const linkValue = await pageA.evaluate(() => navigator.clipboard.readText());
  expect(linkValue.trim()).toBe(pageA.url());

  // Sam: new context, opens the clipboard link
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await joinBoard(pageB, id);

  // Sam sees the same board id and Maya's note
  expect(getBoardId(pageB)).toBe(id);
  await expect(pageB.locator('[data-note-id]')).toHaveCount(1, { timeout: 10_000 });

  // Sam edits (adds a note), Maya sees it
  await pageB.getByTestId('create-sticky').click();
  await expect(pageA.locator('[data-note-id]')).toHaveCount(2, { timeout: 10_000 });

  await contextA.close();
  await contextB.close();
});

test('TC-27: unknown id on cold load → Board not found', async ({ page, browser }) => {
  const unknown = newBoardId();

  // Direct URL to an unknown board
  await page.goto(`/b/${unknown}`);
  await expect(page.getByText('Board not found')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Create a new board' })).toBeVisible();

  // The "Back to home" link is present
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();

  // Verify the board is still unknown via another context
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(`/b/${unknown}`);
  await expect(other.getByText('Board not found')).toBeVisible({ timeout: 10_000 });

  await context.close();
});

test('TC-28: unreachable then healthy → retry message → board opens', async ({ page, browser }) => {
  // Create a board via a separate context (not affected by route abort)
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const boardId = await startBoard(pageA);
  await contextA.close();

  // Open the board with routes aborted on the target page itself
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${boardId}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
    timeout: 10_000,
  });

  // Unroute (restore network) — the retry succeeds and the board opens
  await page.unroute('**/api/boards/*');
  await expect(viewportOf(page)).toBeVisible({ timeout: 15_000 });
  await expectConnected(page);
});

test('TC-29: clipboard denial → manual-copy path', async ({ page }) => {
  // Use init script to stub clipboard.writeText to reject
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      writable: true,
      configurable: true,
    });
  });

  await startBoard(page);

  // Share → Copy link
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();

  // Manual-copy message shown
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();

  // Input is selected (selectionStart = 0, selectionEnd = link length)
  const url = page.url();
  const input = page.getByRole('textbox', { name: 'Board link' });
  const [start, end] = await input.evaluate((el) => [
    (el as HTMLInputElement).selectionStart,
    (el as HTMLInputElement).selectionEnd,
  ]);
  expect(start).toBe(0);
  expect(end).toBe(url.length);
});

test('TC-30: repeated creates eventually hit 429; created boards all open', async ({
  browser,
}) => {
  // Use a single context (same IP) to trigger the rate limiter.
  // Other tests running in parallel may also consume quota, so we create
  // more than BOARD_CREATE_LIMIT boards to ensure the limit is reached.
  const context = await browser.newContext();
  const page = await context.newPage();

  const ids: string[] = [];
  const maxAttempts = BOARD_CREATE_LIMIT + 10;
  let rateLimited = false;

  for (let i = 0; i < maxAttempts; i++) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();

    // Wait for either navigation to a board OR a rate-limit error
    const result = await Promise.race([
      page.waitForFunction(
        () => /^\/b\/[A-Za-z0-9_-]{22}$/.test(window.location.pathname),
        { timeout: 10_000 },
      ).then(() => 'navigated' as const),
      page.waitForSelector('[role="alert"]', { timeout: 10_000 }).then(() => 'error' as const),
    ]);

    if (result === 'error') {
      rateLimited = true;
      break;
    }
    ids.push(getBoardId(page));
  }

  expect(rateLimited, 'should have hit rate limit').toBe(true);

  // All created boards opened successfully
  const context2 = await browser.newContext();
  const results = await Promise.all(
    ids.map(async (id) => {
      const p = await context2.newPage();
      await joinBoard(p, id);
      await p.close();
      return true;
    }),
  );
  expect(results.every(Boolean)).toBe(true);

  // Rate-limit message is visible on the page
  await expect(
    page.getByText("You're creating boards too quickly. Wait a minute and try again."),
  ).toBeVisible();

  await context.close();
  await context2.close();
});

test('TC-31: Share button and panel behaviour (e2e)', async ({ page }) => {
  await startBoard(page);

  // Share button is visible
  const share = page.getByRole('button', { name: 'Share' });
  await expect(share).toBeVisible();

  // No panel until clicked
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Open panel
  await share.click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();

  // Link input shows the current URL
  const input = page.getByRole('textbox', { name: 'Board link' });
  await expect(input).toHaveValue(await page.url());

  // Escape closes
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // Outside click closes
  await share.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(10, 300);
  await expect(panel).toHaveCount(0);
});
