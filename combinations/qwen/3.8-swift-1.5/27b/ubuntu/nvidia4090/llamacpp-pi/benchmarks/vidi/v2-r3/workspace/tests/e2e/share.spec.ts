import { test, expect, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { createBoard, seedLegacyBoard, openBoardInPage } from './helpers/board';

/**
 * Story 5 E2E: share a board with others using a link.
 *
 * TC-26 create, share, join (chromium, clipboard permissions)
 * TC-27 bad link recovery (all browsers)
 * TC-28 flaky service on open (all browsers)
 * TC-29 clipboard blocked (all browsers)
 * TC-31 pre-existing (legacy) board (all browsers)
 */

/** Click "New board" on the home page and wait for the board to render. */
async function createBoardViaHome(page: Page): Promise<string> {
  await page.goto('/');
  const clickAt = Date.now();
  await page.getByTestId('new-board-button').click();
  await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  // Log (not assert) click-to-board against the budget: the spec forbids
  // failing a test on a duration, but the budget is part of the story.
  const elapsed = Date.now() - clickAt;
  console.log(`[story5] click-to-board: ${elapsed}ms (budget ${CREATE_BUDGET_MS}ms)`);
  const url = new URL(page.url());
  const id = url.pathname.split('/')[2] ?? '';
  expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return id;
}

test.describe('TC-26: create, share, join (share.home, share.share_panel, share.open_link)', () => {
  test('Maya creates, copies the link; Sam opens it and they edit together', async ({ browser }) => {
    test.skip(browser.browserType().name() !== 'chromium', 'clipboard read requires chromium');

    const mayaCtx = await browser.newContext();
    await mayaCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const maya = await mayaCtx.newPage();

    // Maya: home → New board → empty board at a fresh /b/<22> link
    const boardId = await createBoardViaHome(maya);
    expect(new URL(maya.url()).pathname).toBe(`/b/${boardId}`);

    // Maya adds a note
    const viewport = maya.getByTestId('board-viewport');
    const box = (await viewport.boundingBox())!;
    await maya.mouse.dblclick(box.x + 300, box.y + 200);
    const note = maya.locator('[data-testid^="sticky-note-"]').first();
    await expect(note).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Maya: Share → panel with the exact board link → Copy link → feedback
    await maya.getByTestId('share-button').click();
    const linkInput = maya.getByTestId('share-link-input');
    const link = await linkInput.inputValue();
    expect(link).toBe(`http://127.0.0.1:8787/b/${boardId}`);

    await maya.getByTestId('copy-link-button').click();
    // PRD: button shows "Link copied" with a tick for 2 seconds
    await expect(maya.getByTestId('copy-link-button')).toHaveText('Link copied ✓');

    // The clipboard really holds the link
    const clipboardText = await maya.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(link);

    // Sam: opens the clipboard text in a fresh context → same board, sees the note
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await sam.goto(clipboardText);
    await sam.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(sam.locator('[data-testid^="sticky-note-"]').first()).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Sam edits: adds his own note → Maya sees it
    const samBox = (await sam.getByTestId('board-viewport').boundingBox())!;
    await sam.mouse.dblclick(samBox.x + 500, samBox.y + 300);
    await expect
      .poll(async () => maya.locator('[data-testid^="sticky-note-"]').count(), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(2);

    await mayaCtx.close();
    await samCtx.close();
  });
});

test.describe('TC-27: bad link recovery (share.not_found)', () => {
  test('never-created link → Board not found → New board works', async ({ page }) => {
    const id = newBoardId();
    await page.goto(`/b/${id}`);

    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByText('Board not found')).toBeVisible();

    // New board from the not-found page → fresh empty board
    await page.getByTestId('new-board-button').click();
    await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
    expect(url.pathname).not.toBe(`/b/${id}`);
    expect(await page.locator('[data-testid^="sticky-note-"]').count()).toBe(0);
  });
});

test.describe('TC-28: flaky service on open (share.open_link)', () => {
  test('existence check fails → retrying message → board opens without reload', async ({ page, context }) => {
    const boardId = await createBoard();

    // Block the existence-check endpoint while the board link is opened
    await context.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${boardId}`);

    await expect(page.getByTestId('board-unreachable')).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

    // Service recovers: the backoff retry succeeds without a reload
    await context.unroute('**/api/boards/*');
    await page.getByTestId('board-viewport').waitFor({ timeout: 15000 });
  });
});

test.describe('TC-29: clipboard blocked (share.share_panel)', () => {
  test('writeText rejects → manual-copy message with the full link selected', async ({ page }) => {
    // Make the clipboard API reject, as a blocked permission would
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('blocked')) },
        configurable: true,
      });
    });

    const boardId = await createBoard();
    await openBoardInPage(page, boardId);

    await page.getByTestId('share-button').click();
    await page.getByTestId('copy-link-button').click();

    await expect(page.getByTestId('manual-copy-message')).toBeVisible();

    const selection = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="share-link-input"]') as HTMLInputElement;
      return {
        value: input.value,
        selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
      };
    });
    expect(selection.value).toBe(`http://127.0.0.1:8787/b/${boardId}`);
    expect(selection.selected).toBe(true);
  });
});

test.describe('TC-31: pre-existing board (share.legacy_boards)', () => {
  test('legacy board (data, no created_at) opens with its content and is editable', async ({ page }) => {
    const id = newBoardId();
    await seedLegacyBoard(id);

    await openBoardInPage(page, id);

    // The seeded note is visible — this is the board, not "Board not found"
    await expect(page.getByTestId('not-found-page')).not.toBeVisible();
    const note = page.locator('[data-testid^="sticky-note-"]').first();
    await expect(note).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(note).toContainText('Legacy note');

    // And it is editable
    const box = (await page.getByTestId('board-viewport').boundingBox())!;
    await page.mouse.dblclick(box.x + 400, box.y + 300);
    await expect
      .poll(async () => page.locator('[data-testid^="sticky-note-"]').count(), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(2);
  });
});
