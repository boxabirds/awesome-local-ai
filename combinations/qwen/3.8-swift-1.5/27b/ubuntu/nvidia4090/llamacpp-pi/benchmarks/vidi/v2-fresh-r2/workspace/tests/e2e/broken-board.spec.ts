/**
 * E2E broken board test: TC-24.
 *
 * Verifies that when the board fails to load:
 * 1. An honest failure message is shown ("This board failed to load")
 * 2. Editing is disabled (double-click does not create notes)
 * 3. Recovery is possible (state returns to connected, editing works again)
 */
import { test, expect, type Page } from '@playwright/test';
import { createBoardAndOpen, setCamera } from './helpers/board';

/** Wait for the test hooks to be available. */
async function waitForHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return !!(window as { __vidi6?: unknown }).__vidi6;
  }, { timeout: 10_000 });
}

/** Set the connection state directly via the test hook. */
async function setConnState(page: Page, state: string): Promise<void> {
  await waitForHooks(page);
  await page.evaluate((s) => {
    const hook = (window as { __vidi6?: { setConnState?: (s: string) => void } }).__vidi6;
    if (!hook?.setConnState) throw new Error('setConnState hook not available');
    hook.setConnState(s);
  }, state);
  // Wait for the state to propagate to the UI
  await page.waitForFunction((expected) => {
    const hook = (window as { __vidi6?: { connectionState: string } }).__vidi6;
    return hook?.connectionState === expected;
  }, state, { timeout: 5000 });
}

test.describe('broken board e2e', () => {
  test.beforeEach(async ({ page }) => {
    await createBoardAndOpen(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await waitForHooks(page);
    // Wait for the board to be connected
    await page.waitForFunction(() => {
      const hook = (window as { __vidi6?: { connectionState: string } }).__vidi6;
      return hook?.connectionState === 'connected';
    }, { timeout: 10_000 });
  });

  test('TC-24: broken board shows honest failure, edit lock, and recovery', async ({ page }) => {
    // Create a note to verify editing works initially.
    await page.mouse.dblclick(400, 300);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();
    await textarea.fill('test-note');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(1);

    // Force load failure.
    await setConnState(page, 'load-failed');

    // 1. Honest failure message is shown.
    const statusBadge = page.locator('[data-testid="connection-status"]');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText('This board failed to load');

    // 2. Edit lock: double-click does NOT create a new note.
    await page.mouse.dblclick(600, 400);
    await page.waitForTimeout(500);
    // Still only 1 note (the one created before the failure).
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(1);

    // 3. Recovery: state returns to connected, editing works again.
    await setConnState(page, 'connected');

    // The failure message should be gone.
    await expect(statusBadge).not.toBeVisible();

    // Editing works again: double-click creates a new note.
    await page.mouse.dblclick(600, 400);
    const textarea2 = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea2).toBeVisible();
    await textarea2.fill('recovered-note');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(2);
  });
});
