import { test, expect } from '@playwright/test';
import { createBoard } from './helpers/participants';
import { CREATE_BUDGET_MS } from '../../src/shared/config';

test.describe('TC-26: Create a board, share, open link in second context', () => {
  test('full link lifecycle: create → copy → open → same board', async ({ browser }) => {
    // Context A: create a board
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await ctxA.newPage();

    // Grant clipboard permission
    await ctxA.grantPermissions(['clipboard-read', 'clipboard-write']);

    await pageA.goto('/');
    const startTime = Date.now();
    await pageA.getByTestId('create-board-btn').click();

    // Should navigate to /b/<id>
    await expect(pageA).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
    await expect(pageA.locator('[data-testid="board-viewport"]')).toBeVisible();
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(CREATE_BUDGET_MS + 3000); // budget + network slack for CI

    // Open share panel
    await pageA.getByTestId('share-btn').click();
    await expect(pageA.getByTestId('share-panel')).toBeVisible();

    // Verify the link input contains the correct URL
    const linkInput = pageA.getByTestId('share-link-input');
    const boardLink = await linkInput.inputValue();
    expect(boardLink).toMatch(/^https?:\/\/.*\/b\/[A-Za-z0-9_-]{22}$/);

    // Click Copy link
    await pageA.getByTestId('copy-link-btn').click();
    await expect(pageA.getByTestId('copy-link-btn')).toContainText('Link copied');

    // Read clipboard
    const clipboardContent = await pageA.evaluate(() => navigator.clipboard.readText());
    expect(clipboardContent).toBe(boardLink);

    // Context B: open the same URL
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageB = await ctxB.newPage();
    await pageB.goto(boardLink);

    // Should see the board (not NotFound)
    await expect(pageB.locator('[data-testid="board-viewport"]')).toBeVisible({ timeout: 10_000 });

    // Add a sticky on page A, verify it appears on page B
    await pageA.getByTestId('add-sticky-btn').click();
    await expect(pageB.locator('[data-testid^="sticky-note-"]').first()).toBeVisible({ timeout: 5_000 });

    // Sam (page B) edits the note text
    const noteB = pageB.locator('[data-testid^="sticky-note-"]').first();
    await noteB.dblclick();
    await pageB.keyboard.type('hello from Sam');
    // Maya (page A) sees the edit
    await expect(pageA.locator('[data-testid^="sticky-note-"]').first()).toContainText('hello from Sam', { timeout: 5_000 });

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('TC-27: Bad link recovery', () => {
  test('never-created board URL -> Board not found -> Create a new board -> fresh board', async ({ page }) => {
    // Generate a random valid ID that was never created
    const fakeId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63])
      .join('');

    await page.goto(`/b/${fakeId}`);
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();

    // Click "Create a new board" from the not-found page
    await page.getByTestId('not-found-create-btn').click();

    // Should navigate to a new board
    await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Board should be empty (no sticky notes)
    await expect(page.locator('[data-testid^="sticky-note-"]')).toHaveCount(0);
  });
});

test.describe('TC-28: Flaky service on open', () => {
  test('abort GET /api/boards/:id shows retry; unroute loads board', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // First create a board (without route blocking)
    const boardId = await createBoard(page);

    // Now abort all requests to the board API
    await page.route('**/api/boards/*', (route) => route.abort());

    await page.goto(`/b/${boardId}`);

    // Should show unreachable message
    await expect(page.getByTestId('board-unreachable')).toBeVisible({ timeout: 10_000 });
    expect(await page.getByTestId('board-unreachable').textContent()).toContain(
      "Couldn't reach vidi6. Retrying…",
    );

    // Remove the route interception → retry should succeed
    await page.unroute('**/api/boards/*');

    // Wait for retry to succeed (backoff is 1000ms, then 2000ms, etc.)
    await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible({ timeout: 15_000 });

    await ctx.close();
  });
});

test.describe('TC-29: Clipboard writeText rejects → manual copy', () => {
  test('writeText rejects → manual-copy message, input selected', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    const boardId = await createBoard(page);

    // Override clipboard.writeText to reject
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
    });

    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Open share panel
    await page.getByTestId('share-btn').click();
    await expect(page.getByTestId('share-panel')).toBeVisible();

    // Click Copy link
    await page.getByTestId('copy-link-btn').click();

    // Should show manual copy message
    await expect(page.getByTestId('manual-copy-msg')).toBeVisible({ timeout: 5_000 });
    expect(await page.getByTestId('manual-copy-msg').textContent()).toContain('Ctrl+C');

    // Input text should match the link
    const input = page.getByTestId('share-link-input');
    const value = await input.inputValue();
    expect(value).toBe(`${page.url().replace(/\/b\/.*/, '')}/b/${boardId}`);

    await ctx.close();
  });
});

test.describe('TC-30: Rate-limited create shows exact message', () => {
  test('exhaust rate limit → rate-limit message shown', async ({ page }) => {
    // Exhaust the rate limit (10 max per 60s for same IP)
    for (let i = 0; i < 11; i++) {
      await page.request.post('/api/boards');
    }

    // Now try creating via UI
    await page.goto('/');
    await page.getByTestId('create-board-btn').click();

    await expect(page.getByTestId('rate-limit-error')).toBeVisible({ timeout: 5_000 });
    expect(await page.getByTestId('rate-limit-error').textContent()).toBe(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
  });
});

test.describe('TC-31: Pre-existing legacy board', () => {
  test('seed legacy board via test hook → open link → board with seeded note', async ({ page }) => {
    // Generate a board id
    const boardId = await createBoard(page);

    // Seed legacy content via test hook
    const hookRes = await page.request.post(`/__test/boards/${boardId}/seed-legacy`);
    expect(hookRes.ok()).toBeTruthy();

    // Navigate to the board
    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible({ timeout: 10_000 });

    // Should see at least one sticky note (seeded by the hook)
    await expect(page.locator('[data-testid^="sticky-note-"]').first()).toBeVisible({ timeout: 5_000 });
  });
});
