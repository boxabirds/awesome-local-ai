import { test, expect } from '@playwright/test';
import { newE2eBoardId } from './helpers/participants';
import { getNoteIds } from './helpers/sticky';

/**
 * TC-24: E2E broken board — honest failure, edit lock, recovery without reload.
 *
 * 1. Create a 25-note board via the seed test hook.
 * 2. Corrupt the snapshot via test hook.
 * 3. Open board in fresh context → red "This board couldn't be loaded. Retrying…"
 * 4. Verify editing is disabled.
 * 5. Repair via test hook; wait > LOAD_RETRY_MIN_INTERVAL_MS → board appears,
 *    badge gone, creating a note works — no page reload.
 */
test.describe('TC-24: Broken board — honest failure, edit lock, recovery', () => {
  test('corrupt → load failure → repair → recovery without reload', async ({ browser }) => {
    const boardId = newE2eBoardId();

    // Step 1: Create the board via test hook, then open to establish connection.
    const seedRes = await fetch(`http://localhost:8787/api/test/${boardId}/seed?notes=25`, {
      method: 'POST',
    });
    expect(seedRes.ok).toBe(true);

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected' ||
            (window as any).__vidi6?.connectionState === 'confirmed',
      undefined,
      { timeout: 15000 },
    );
    // Close the browser
    await ctx.close();

    // Step 2: Corrupt the snapshot
    const corruptRes = await fetch(`http://localhost:8787/api/test/${boardId}/corrupt-snapshot`, {
      method: 'POST',
    });
    expect(corruptRes.ok).toBe(true);

    // Step 3: Open board in fresh context → load failure
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    await page2.goto(`/b/${boardId}`);

    // Wait for load_failed state
    await page2.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'load_failed',
      undefined,
      { timeout: 15000 },
    );

    // Verify red badge is visible
    const badge = page2.locator('[role="status"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("couldn't be loaded");
    await expect(badge).toContainText('Retrying');

    // Step 4: Verify editing is disabled
    // Toolbar button should be disabled
    const stickyBtn = page2.locator('[data-testid="create-sticky-button"]');
    await expect(stickyBtn).toBeDisabled();

    // No notes should be rendered (board is empty due to load failure)
    const notes = await page2.locator('[data-testid="sticky-note-wrapper"]').count();
    expect(notes).toBe(0);

    // Double-clicking the board should not create a note
    await page2.locator('[data-testid="board-viewport"]').dblclick({ position: { x: 400, y: 400 } });
    await page2.waitForTimeout(500);
    const notesAfterDblclick = await page2.locator('[data-testid="sticky-note-wrapper"]').count();
    expect(notesAfterDblclick).toBe(0);

    // Step 5: Repair and wait for recovery
    const repairRes = await fetch(`http://localhost:8787/api/test/${boardId}/repair`, {
      method: 'POST',
    });
    expect(repairRes.ok).toBe(true);

    // Wait for the board to recover (provider retries, connection state goes back to connected)
    // LOAD_RETRY_MIN_INTERVAL_MS is 5000ms, provider backoff retry happens within a few seconds
    await page2.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 30000 },
    );

    // Board should now show notes
    await page2.waitForFunction(
      () => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length >= 25,
      undefined,
      { timeout: 10000 },
    );
    const noteCountAfter = (await getNoteIds(page2)).length;
    expect(noteCountAfter).toBe(25);

    // Badge should be gone
    await expect(badge).not.toBeVisible();

    // Editing should work again: create a note via button
    await expect(stickyBtn).not.toBeDisabled();
    await stickyBtn.click();
    await page2.waitForFunction(
      () => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length >= 26,
      undefined,
      { timeout: 5000 },
    );

    await ctx2.close();
  });
});
