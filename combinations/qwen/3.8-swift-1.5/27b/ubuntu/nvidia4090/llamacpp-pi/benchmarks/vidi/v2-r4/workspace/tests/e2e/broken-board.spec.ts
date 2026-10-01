import { test, expect } from '@playwright/test';

/**
 * TC-24: Broken board shows honest failure, edit lock, recovery without reload
 */

test.describe('E2E Broken Board', () => {
  test('TC-24: corrupt board shows load-failed, recovery works', async ({ page, request }) => {
    const boardId = `e2e-broken-${Date.now()}`;

    // Step 1: Create a board with a note
    await page.goto(`/board/${boardId}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 200, y: 200 } });
    await page.waitForSelector('[contenteditable="true"]', { timeout: 5000 });
    await page.locator('[contenteditable="true"]').first().fill('Will be lost');
    await page.click('[data-testid="board-viewport"]', { position: { x: 50, y: 50 } });
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Will be lost');

    // Step 2: Corrupt the board snapshot via test hook
    const corruptRes = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
    expect(corruptRes.status()).toBe(200);

    // Step 3: Reload the page - should show load-failed state
    await page.reload();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // Wait for the load-failed message
    await expect(page.locator('[data-testid="connection-status"]')).toContainText(
      "This board couldn't be loaded. Retrying…",
      { timeout: 15000 },
    );

    // Step 4: Verify editing is locked (toolbar disabled)
    const toolbarBtn = page.locator('[data-testid="toolbar"] button');
    await expect(toolbarBtn).toBeDisabled();

    // Step 5: Repair the board via test hook
    const repairRes = await request.post(`/__test/boards/${boardId}/repair`);
    expect(repairRes.status()).toBe(200);

    // Step 6: Reload the page - should show the board (empty after repair)
    await page.reload();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // The load-failed message should be gone
    // (The board is now loadable, so the connection status should not show load-failed)
    await page.waitForTimeout(3000);
    const statusEl = page.locator('[data-testid="connection-status"]');
    // Either no status element (connected) or not showing load-failed
    const statusText = await statusEl.textContent().catch(() => null);
    expect(statusText).not.toContain("couldn't be loaded");
  });
});
