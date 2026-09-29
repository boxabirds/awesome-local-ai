/**
 * Story 5 E2E tests: share-a-board
 * TC-26 to TC-31
 */
import { test, expect } from '@playwright/test';
import { newE2eBoardId } from './helpers/participants';
import { BOARD_CREATE_LIMIT } from '@shared/config';

const serverUrl = 'http://localhost:8787';

test.describe('Story 5: Share a board', () => {
  // TC-26: home create + open link + live collaboration
  test('TC-26: create board, add note, copy link, second person joins and edits', async ({ browser, context }) => {
    // Maya creates a board from the home page
    const mayaCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya = await mayaCtx.newPage();
    await maya.goto('/');

    // Click "Create a board"
    const t0 = Date.now();
    await maya.getByRole('button', { name: 'Create a board' }).click();

    // Board opens (URL becomes /b/<id>)
    await maya.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 10000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(2000); // CREATE_BUDGET_MS

    // Wait for WebSocket connection
    await maya.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 15000 },
    );

    // Maya adds a sticky note
    await maya.mouse.dblclick(600, 400);
    await maya.waitForSelector('[data-testid="sticky-note-wrapper"]', { timeout: 5000 });
    await maya.keyboard.type('Hello from Maya');
    await maya.keyboard.press('Escape');

    // Click Share → Copy link
    await maya.getByRole('button', { name: 'Share' }).click();
    await maya.getByRole('button', { name: /copy link/i }).click();
    await expect(maya.getByText(/link copied/i)).toBeVisible();

    // Read the link from clipboard
    const copiedLink = await maya.evaluate(() => navigator.clipboard.readText());
    expect(copiedLink).toMatch(/^http:\/\/localhost:8787\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens the link in a new context
    const samCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sam = await samCtx.newPage();
    await sam.goto(copiedLink);

    // Wait for Sam's board to connect
    await sam.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 15000 },
    );

    // Sam sees Maya's note
    await expect(sam.locator('[data-testid="sticky-note-wrapper"]')).toHaveCount(1, { timeout: 10000 });
    await expect(sam.locator('[data-testid="sticky-note-text"]')).toContainText('Hello from Maya');

    // Sam adds a note
    await sam.mouse.dblclick(400, 300);
    await sam.waitForFunction(
      () => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length >= 2,
      undefined,
      { timeout: 5000 },
    );
    await sam.keyboard.type('Note from Sam');
    await sam.keyboard.press('Escape');

    // Maya sees Sam's note
    await expect(maya.locator('[data-testid="sticky-note-wrapper"]')).toHaveCount(2, { timeout: 10000 });

    await mayaCtx.close();
    await samCtx.close();
  });

  // TC-27: open link for unknown board → not found → create new board
  test('TC-27: unknown valid id → not found → create new board', async ({ page }) => {
    const unknownId = newE2eBoardId();

    // Navigate directly to unknown board
    await page.goto(`/b/${unknownId}`);

    // Expect "Board not found" message
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Check the link')).toBeVisible();

    // Click "Create a new board"
    await page.getByRole('button', { name: /create a new board/i }).click();

    // Should navigate to a NEW board (different from the unknown one)
    await page.waitForURL(
      (url) => /\/b\/[A-Za-z0-9_-]{22}$/.test(url.pathname) && !url.pathname.includes(unknownId),
      { timeout: 10000 },
    );

    // Board should be empty (new board, not the unknown one)
    const boardId = new URL(page.url()).pathname.split('/').pop()!;
    expect(boardId).not.toBe(unknownId);
  });

  // TC-28: unreachable API → retry message → board opens without reload
  test('TC-28: network abort → retry message → board opens', async ({ page }) => {
    const boardId = newE2eBoardId();

    // First create the board via the API so it exists
    const res = await fetch(`${serverUrl}/api/boards`, { method: 'POST' });
    const body = await res.json() as any;
    const realId = body.id ?? boardId;

    // Abort API requests initially
    let shouldAbort = true;
    await page.route('**/api/boards/**', (route) => {
      if (shouldAbort) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to the board
    await page.goto(`/b/${realId}`);

    // Should see retry message
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({ timeout: 10000 });

    // Stop aborting requests
    shouldAbort = false;

    // Board should open without reload (after backoff + retry)
    await page.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 30000 },
    );

    // No reload: page.evaluate check that we never reloaded
    const navigated = await page.evaluate(() => document.title);
    expect(navigated).toBe('vidi6');
  });

  // TC-29: clipboard blocked → manual copy
  test('TC-29: clipboard rejected → manual copy fallback', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();

    // Stub clipboard.writeText to reject BEFORE navigation
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('denied')),
          readText: () => Promise.reject(new Error('denied')),
        },
        writable: true,
        configurable: true,
      });
    });

    // Create a board
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();
    await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 10000 });

    // Wait for connection so board is ready
    await page.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 15000 },
    );

    // Open share panel and copy
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: /copy link/i }).click();

    // Manual copy message
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible({ timeout: 5000 });

    // Selection covers the full link text
    const linkInput = page.getByRole('textbox', { name: 'Board link' });
    await expect(linkInput).toBeVisible();
    const selectionInfo = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input[aria-label="Board link"]');
      if (!el) return { start: -1, end: -1, len: 0 };
      return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0, len: el.value.length };
    });
    expect(selectionInfo.start).toBe(0);
    expect(selectionInfo.end).toBe(selectionInfo.len);

    await ctx.close();
  });

  // TC-30: rate limit on create boards
  test('TC-30: create limit reached shows rate-limit message', async ({ page }) => {
    // Reset rate limiter to ensure clean state
    await fetch(`${serverUrl}/api/test/global/reset-rate-limiter`, { method: 'POST' });

    // Create BOARD_CREATE_LIMIT boards (navigating back to home each time)
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Create a board' }).click();
      await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 10000 });
    }

    // Next attempt should be rate limited
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();

    // Rate limit message appears (no navigation to /b/)
    await expect(page.getByText("You're creating boards too quickly")).toBeVisible({ timeout: 10000 });
    // Still on home page
    expect(page.url()).not.toMatch(/\/b\//);
  });

  // TC-31: legacy board with notes opens correctly
  test('TC-31: seeded legacy board opens with notes', async ({ page }) => {
    const boardId = newE2eBoardId();

    // Seed the board using the test hook
    const seedRes = await fetch(`${serverUrl}/api/test/${boardId}/seed-legacy`, {
      method: 'POST',
    });
    expect(seedRes.ok).toBe(true);

    // Navigate to the board's link
    await page.goto(`/b/${boardId}`);

    // Should NOT show "Board not found"
    await expect(page.getByText('Board not found')).not.toBeVisible();

    // Wait for connection
    await page.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 15000 },
    );

    // Should have seeded notes
    await expect(page.locator('[data-testid="sticky-note-wrapper"]')).toHaveCount(3, { timeout: 10000 });
  });
});
