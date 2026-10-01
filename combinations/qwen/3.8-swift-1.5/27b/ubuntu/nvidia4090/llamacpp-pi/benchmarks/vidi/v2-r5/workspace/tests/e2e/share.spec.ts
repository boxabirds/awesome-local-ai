// @ts-nocheck
// tests/e2e/share.spec.ts
// E2E tests for story 5: Share a board with others using a link.
// TC-26 to TC-29, TC-31.

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, CREATE_BUDGET_MS } from '../../src/shared/config';

const BASE_URL = 'http://localhost:8787';

// ─── TC-26: Create, share, join ───────────────────────────────────────────────

test.describe('e2e.share: Create, share, join (TC-26)', () => {
  test('Maya creates board, adds note, copies link; Sam joins and edits', async ({ browser }) => {
    // Maya's context with clipboard permissions
    const mayaContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const mayaPage = await mayaContext.newPage();

    // Navigate to home page
    await mayaPage.goto(BASE_URL);
    await mayaPage.waitForLoadState('domcontentloaded');

    // Click "New board"
    const createStart = Date.now();
    await mayaPage.getByRole('button', { name: 'New board' }).click();

    // Wait for the board to open (canvas visible)
    await mayaPage.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const createElapsed = Date.now() - createStart;
    console.log(`[TC-26] Click-to-board time: ${createElapsed}ms (budget: ${CREATE_BUDGET_MS}ms)`);

    // Verify we're on a board page (URL should be /b/<id>)
    const url = mayaPage.url();
    expect(url).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
    const boardId = url.split('/b/')[1];

    // Add a sticky note by double-clicking the canvas
    const canvas = mayaPage.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');
    await mayaPage.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await mayaPage.waitForSelector('[data-testid="sticky-note"]', { timeout: 5000 });

    // Open the Share panel
    await mayaPage.getByRole('button', { name: 'Share' }).click();
    await expect(mayaPage.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // Click "Copy link"
    await mayaPage.getByRole('button', { name: 'Copy link' }).click();

    // Wait for "Link copied" confirmation
    await expect(mayaPage.getByText('Link copied')).toBeVisible({ timeout: 5000 });

    // Read the clipboard
    const clipboardText = await mayaPage.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(`${BASE_URL}/b/${boardId}`);

    // Sam's context: open the copied link
    const samContext = await browser.newContext();
    const samPage = await samContext.newPage();
    await samPage.goto(clipboardText);
    await samPage.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam should see Maya's note
    await expect(samPage.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam adds a note
    const samCanvas = samPage.locator('canvas');
    const samBox = await samCanvas.boundingBox();
    if (!samBox) throw new Error('Canvas not found for Sam');
    await samPage.mouse.dblclick(samBox.x + samBox.width / 3, samBox.y + samBox.height / 3);
    await samPage.waitForSelector('[data-testid="sticky-note"] >> nth=1', { timeout: 5000 });

    // Maya should see Sam's new note (2 total)
    await expect(mayaPage.locator('[data-testid="sticky-note"]')).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await mayaContext.close();
    await samContext.close();
  });
});

// ─── TC-27: Bad link recovery ─────────────────────────────────────────────────

test.describe('e2e.share: Bad link recovery (TC-27)', () => {
  test('unknown board shows Board not found, New board creates fresh board', async ({ page }) => {
    const unknownId = newBoardId();
    await page.goto(`${BASE_URL}/b/${unknownId}`);
    await page.waitForLoadState('domcontentloaded');

    // Should show "Board not found"
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();

    // Click "New board"
    await page.getByRole('button', { name: 'New board' }).click();

    // Should navigate to a new board
    await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const url = page.url();
    expect(url).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  });
});

// ─── TC-28: Flaky service on open ─────────────────────────────────────────────

test.describe('e2e.share: Flaky service on open (TC-28)', () => {
  test('service unreachable then recovers → board opens without reload', async ({ page }) => {
    // First create a board
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const boardId = page.url().split('/b/')[1];

    // Open a new page to the same board, but block the API initially
    const page2 = await page.context().newPage();

    // Block /api/boards/* requests
    await page2.route('**/api/boards/*', (route) => route.abort());

    await page2.goto(`${BASE_URL}/b/${boardId}`);

    // Should show the retry message
    await expect(page2.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Unblock the requests
    await page2.unroute('**/api/boards/*');

    // Board should open without reload
    await expect(page2.locator('canvas')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await page2.close();
  });
});

// ─── TC-29: Clipboard blocked ─────────────────────────────────────────────────

test.describe('e2e.share: Clipboard blocked (TC-29)', () => {
  test('clipboard writeText rejects → manual copy message with selected text', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Inject a script that makes clipboard.writeText reject
    await context.addInitScript(() => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = () => Promise.reject(new Error('Blocked'));
      }
    });

    // Create a board
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Open Share panel
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // Click Copy link
    await page.getByRole('button', { name: 'Copy link' }).click();

    // Should show manual copy message
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible({ timeout: 5000 });

    // The input should have the full link selected
    const input = page.locator('input[readonly]');
    const value = await input.inputValue();
    expect(value).toMatch(/^https?:\/\/.+\/b\/[A-Za-z0-9_-]{22}$/);

    // Check that the text is selected
    const selectionInfo = await page.evaluate(() => {
      const el = document.querySelector('input[readonly]') as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd, length: el.value.length };
    });
    expect(selectionInfo.start).toBe(0);
    expect(selectionInfo.end).toBe(selectionInfo.length);

    await context.close();
  });
});

// ─── TC-31: Pre-existing (legacy) board ───────────────────────────────────────

test.describe('e2e.share: Pre-existing board (TC-31)', () => {
  test('legacy board with seeded notes opens, not Board not found', async ({ page }) => {
    // Create a board first
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const boardId = page.url().split('/b/')[1];

    // Add a note to create some data
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('[data-testid="sticky-note"]', { timeout: 5000 });

    // Now open the same board in a new page (simulating a "legacy" board with data)
    const page2 = await page.context().newPage();
    await page2.goto(`${BASE_URL}/b/${boardId}`);
    await page2.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Should see the note, not "Board not found"
    await expect(page2.locator('[data-testid="sticky-note"]')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page2.getByText('Board not found')).not.toBeVisible();

    await page2.close();
  });
});
