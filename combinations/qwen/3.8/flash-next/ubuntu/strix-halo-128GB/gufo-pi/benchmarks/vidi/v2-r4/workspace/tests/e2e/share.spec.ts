/**
 * E2E share workflows (story 5).
 * TC-26: Create, share, join
 * TC-27: Bad link recovery
 * TC-28: Flaky service on open
 * TC-29: Clipboard blocked
 * TC-31: Pre-existing (legacy) board
 */
import { expect, test, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, CREATE_BUDGET_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  noteText,
  doubleClickToCreate,
  clickEmptyBoard,
  typeText,
} from './helpers/sticky';
import { board } from './helpers/board';

/** Create a board via API and return its id. */
async function createBoardApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Wait for the connection to be in 'connected' state. */
async function waitForConnected(page: Page) {
  await page.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

test.describe('TC-26: Create, share, join', () => {
  test.use({
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test('Maya creates board, shares link; Sam opens link, both edit', async ({ browser, context }) => {
    const startTime = Date.now();

    // Maya goes to home page and clicks New board
    const mayaPage = await context.newPage();
    await mayaPage.goto('/');
    const newBoardBtn = mayaPage.getByRole('button', { name: 'New board' });
    await expect(newBoardBtn).toBeVisible();
    await newBoardBtn.click();

    // Board opens
    await expect(board(mayaPage)).toBeVisible();
    await waitForConnected(mayaPage);
    const clickToBoardMs = Date.now() - startTime;
    console.log(`TC-26: click-to-board time = ${clickToBoardMs}ms (budget: ${CREATE_BUDGET_MS}ms)`);
    // Budget is logged, not asserted

    // Maya creates a note
    await doubleClickToCreate(mayaPage, 400, 300);
    await typeText(mayaPage, 'Shared note');
    await clickEmptyBoard(mayaPage);

    // Maya clicks Share
    await mayaPage.getByRole('button', { name: 'Share' }).click();
    const panel = mayaPage.getByRole('dialog', { name: 'Share board' });
    await expect(panel).toBeVisible();

    // Copy link
    await mayaPage.getByRole('button', { name: 'Copy link' }).click();
    await expect(mayaPage.getByText(/Link copied/)).toBeVisible();

    // Read clipboard
    const copiedLink = await mayaPage.evaluate(async () => {
      return navigator.clipboard.readText();
    });
    expect(copiedLink).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens the link in a new context
    const samCtx: BrowserContext = await browser.newContext();
    const samPage = await samCtx.newPage();
    await samPage.goto(copiedLink);
    await expect(board(samPage)).toBeVisible();
    await waitForConnected(samPage);

    // Sam sees Maya's note
    await samPage.waitForFunction((count) => {
      return document.querySelectorAll('[data-testid="sticky-note"]').length >= count;
    }, 1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(noteText(samPage, 0)).toContainText('Shared note');

    // Sam edits the note
    await doubleClickToCreate(samPage, 600, 400);
    await typeText(samPage, 'From Sam');
    await clickEmptyBoard(samPage);

    // Maya sees Sam's edit
    await mayaPage.waitForFunction((count) => {
      return document.querySelectorAll('[data-testid="sticky-note"]').length >= count;
    }, 2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await mayaPage.close();
    await samCtx.close();
  });
});

test.describe('TC-27: Bad link recovery', () => {
  test('unknown board id shows Board not found; New board creates fresh board', async ({ page }) => {
    const fakeId = newBoardId();
    await page.goto(`/b/${fakeId}`);

    // Should show Board not found
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Click New board
    await page.getByRole('button', { name: 'New board' }).click();

    // Should open a new board
    await expect(board(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});

test.describe('TC-28: Flaky service on open', () => {
  test('unreachable then reachable shows retry then opens board', async ({ page, request }) => {
    // Create a board first so it exists
    const boardId = await createBoardApi(request);

    // Block the API route
    await page.route('**/api/boards/**', (route) => {
      route.abort();
    });

    // Navigate to the board
    await page.goto(`/b/${boardId}`);

    // Should show retry message
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Unblock the route
    await page.unroute('**/api/boards/**');

    // Board should open without reload
    await expect(board(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});

test.describe('TC-29: Clipboard blocked', () => {
  test('writeText rejects → manual copy message with selection', async ({ page, request }) => {
    // Create a board
    const boardId = await createBoardApi(request);

    // Install a script that makes clipboard.writeText reject
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('denied')),
          readText: () => Promise.resolve(''),
        },
        writable: true,
        configurable: true,
      });
    });

    await page.goto(`/b/${boardId}`);
    await expect(board(page)).toBeVisible();
    await waitForConnected(page);

    // Click Share
    await page.getByRole('button', { name: 'Share' }).click();
    const panel = page.getByRole('dialog', { name: 'Share board' });
    await expect(panel).toBeVisible();

    // Click Copy link
    await page.getByRole('button', { name: 'Copy link' }).click();

    // Should show manual copy message
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();

    // The input should have the full link selected
    const input = page.getByRole('textbox');
    const inputValue = await input.inputValue();
    expect(inputValue).toBe(`${page.url().replace(/\/b\/.*$/, '')}/b/${boardId}`);
  });
});

test.describe('TC-31: Pre-existing (legacy) board', () => {
  test('legacy board with seeded data opens correctly', async ({ page, request }) => {
    // Use a valid but never-created board id
    const legacyId = newBoardId();

    // Seed legacy board via test hook
    const seedRes = await request.post(`/api/test-hooks/seed-legacy-board?boardId=${legacyId}`);
    expect(seedRes.ok()).toBeTruthy();

    // Open the board
    await page.goto(`/b/${legacyId}`);
    await expect(board(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await waitForConnected(page);

    // Should see the seeded note
    await page.waitForFunction(() => {
      return document.querySelectorAll('[data-testid="sticky-note"]').length >= 1;
    }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(noteText(page, 0)).toContainText('Legacy note text');
  });
});
