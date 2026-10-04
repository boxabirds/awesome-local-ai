/**
 * Sharing a board by link, end to end (story 5, task 6): TC-26, TC-27, TC-28, TC-29.
 *
 * These run against the ordinary dev server (no test hooks) on chromium.
 *
 *   * TC-26 the whole golden path: create with New board, share the link, a second
 *     person opens exactly that link and they are on the same board.
 *   * TC-27 a link to a board that does not exist shows Board not found, and the
 *     probe creates nothing.
 *   * TC-28 with the board service blocked mid-check the page says it is retrying,
 *     and once the service answers again the board opens without a reload.
 *   * TC-29 when the browser refuses to copy, the link is offered for copying by
 *     hand, already selected.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { CREATE_BUDGET_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyByButton, notes } from './helpers/sticky-notes';
import { createBoard } from './helpers/participants';

const VIEWPORT = { width: 1280, height: 800 };

/** A context allowed to use the clipboard (the golden path copies the link). */
function contextWithClipboard(browser: Browser, permissions: string[]): Promise<BrowserContext> {
  return browser.newContext({ viewport: VIEWPORT, permissions });
}

/** A board context that never needs the clipboard (no permissions granted). */
function plainContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: VIEWPORT });
}

async function boardReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-board-surface]', { timeout: 15_000 });
}

test.describe('sharing a board by link', () => {
  test('TC-26 create, share the link, second person joins the same board', async ({ browser }) => {
    const maya = await contextWithClipboard(browser, ['clipboard-write', 'clipboard-read']);
    const page = await maya.newPage();

    // Maya clicks New board; the wait is what must stay inside the budget.
    await page.goto('/');
    const started = Date.now();
    await page.getByRole('button', { name: 'New board' }).click();
    await boardReady(page);
    const clickToBoardMs = Date.now() - started;
    console.log(`TC-26 click-to-board: ${clickToBoardMs}ms (budget ${CREATE_BUDGET_MS}ms)`);

    // Maya puts something on the board.
    await createStickyByButton(page);
    await expect(notes(page)).toHaveCount(1);

    // Maya shares: open the panel and copy the link.
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByTestId('share-copy').click();
    // The panel holds the full board address — that is what Sam is sent.
    const link = await page.getByTestId('share-link').inputValue();
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens exactly that link.
    const sam = await plainContext(browser);
    const samPage = await sam.newPage();
    await samPage.goto(link);
    await boardReady(samPage);

    // Sam sees Maya's note — the same board, not a copy of the empty one.
    await expect(notes(samPage)).toHaveCount(1);

    // Sam edits; Maya sees it.
    await createStickyByButton(samPage);
    await expect(notes(page)).toHaveCount(2);
    await expect(notes(samPage)).toHaveCount(2);

    await maya.close();
    await sam.close();
  });

  test('TC-27 a link to a non-existent board shows Board not found and creates nothing', async ({
    page,
    request,
  }) => {
    // A validly-shaped code that is certainly not a board.
    const fake = newBoardId();
    await page.goto(`/b/${fake}`);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('not-found-heading')).toHaveText('Board not found');

    // Checking a link must not create the thing it is looking for.
    expect((await request.get(`/api/boards/${fake}`)).status()).toBe(404);

    // A malformed code is reported the same way, so probing cannot tell them apart.
    await page.goto('/b/not-a-valid-code');
    await expect(page.getByTestId('not-found-page')).toBeVisible();

    // The board on the home page is a different board — the button still works.
    await page.getByRole('button', { name: 'New board' }).click();
    await boardReady(page);
  });

  test('TC-28 with the service down mid-check it retries and opens once it recovers', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);

    const context = await plainContext(browser);
    const page = await context.newPage();
    // Block only the board-existence call; the page and assets still load.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${boardId}`);

    await expect(page.getByText(/Couldn.t reach vidi6/)).toBeVisible({ timeout: 15_000 });

    // The service comes back: the board opens by itself, with no reload.
    await page.unroute('**/api/boards/*');
    await boardReady(page);
    expect(page.url()).toContain(`/b/${boardId}`);

    await context.close();
  });

  test('TC-29 when copy is refused it offers the link for copying by hand', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);

    const context = await plainContext(browser);
    const page = await context.newPage();
    // Make the clipboard refuse, as a denied permission looks to the app.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      });
    });
    await page.goto(`/b/${boardId}`);
    await boardReady(page);

    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByTestId('share-copy').click();

    await expect(page.getByTestId('share-manual')).toBeVisible();
    const { start, end, value } = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('[data-testid="share-link"]')!;
      return { start: field.selectionStart, end: field.selectionEnd, value: field.value };
    });
    expect(value.endsWith(`/b/${boardId}`)).toBe(true);
    expect(start).toBe(0);
    expect(end).toBe(value.length);

    await context.close();
  });
});

