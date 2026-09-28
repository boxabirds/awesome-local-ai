import { test, expect } from '@playwright/test';
import { startWrangler, type WranglerInstance } from './helpers/wrangler-process';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

/**
 * TC-24: E2E broken board test.
 *
 * 1. Create a board with notes, corrupt snapshot via test hook
 * 2. Restart server → open board in fresh context → red "This board couldn't be loaded. Retrying…"
 * 3. Editing is blocked (dblclick and Sticky note button create nothing)
 * 4. Repair; wait > LOAD_RETRY_MIN_INTERVAL_MS → board loads, badge gone, editing works
 *
 * Requires TEST_HOOKS=1 on the wrangler dev instance.
 *
 * Run with: npx playwright test --config playwright.persistence.config.ts
 */

async function makeBoardId(serverUrl: string): Promise<string> {
  const res = await fetch(`${serverUrl}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const body = await res.json() as { id: string };
  return body.id;
}

async function corruptBoard(serverUrl: string, boardId: string): Promise<void> {
  const res = await fetch(`${serverUrl}/__test/boards/${boardId}/corrupt-snapshot`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Corrupt failed: ${res.status} ${await res.text()}`);
}

async function repairBoard(serverUrl: string, boardId: string): Promise<void> {
  const res = await fetch(`${serverUrl}/__test/boards/${boardId}/repair`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Repair failed: ${res.status} ${await res.text()}`);
}

test.describe('TC-24: Broken board - honest failure, edit lock, recovery without reload', () => {
  test('corrupt snapshot → red message, no editing; repair → loads without reload', async ({ browser }) => {
    test.setTimeout(120_000);

    const server: WranglerInstance = await startWrangler();
    const boardId = await makeBoardId(server.url);

    try {
      // Step 1: Create a board with some notes
      const seedCtx = await browser.newContext();
      const seedPage = await seedCtx.newPage();
      await seedPage.goto(`${server.url}/b/${boardId}`);
      await expect(seedPage.locator('[data-testid="board-viewport"]')).toBeVisible();
      await expect(seedPage.locator('[data-testid="connection-status"]')).toBeHidden({ timeout: 5000 });

      // Create 5 notes via dblclick
      for (let i = 0; i < 5; i++) {
        await seedPage.mouse.dblclick(400 + i * 60, 300);
        await seedPage.locator('[data-testid="sticky-textarea"]').waitFor({ timeout: 3000 });
        await seedPage.locator('[data-testid="sticky-textarea"]').fill(`Retro item ${i}`);
        await seedPage.locator('[data-testid="sticky-textarea"]').press('Escape');
      }
      await expect(seedPage.locator('[data-testid^="sticky-note-"]')).toHaveCount(5, { timeout: 5000 });
      await seedCtx.close();

      // Give DO time to persist
      await new Promise((r) => setTimeout(r, 1000));

      // Step 2: Corrupt the snapshot via test hook
      // This hook inserts a corrupt snapshot chunk and sets compaction_last_seq=0
      // so the next load will try snapshot → fail → LoadFailed
      await corruptBoard(server.url, boardId);

      // Step 3: Restart server (forces DO to evict and reload from storage)
      await server.stop();
      const server2 = await startWrangler();

      try {
        // Step 4: Open the board → should get load_failed
        const brokenCtx = await browser.newContext();
        const brokenPage = await brokenCtx.newPage();
        await brokenPage.goto(`${server2.url}/b/${boardId}`);
        await expect(brokenPage.locator('[data-testid="board-viewport"]')).toBeVisible();

        // Should show red load_failed badge
        const badge = brokenPage.locator('[data-testid="connection-status"]');
        await expect(badge).toBeVisible({ timeout: 10000 });
        await expect(badge).toHaveText("This board couldn't be loaded. Retrying…");
        await expect(badge).toHaveClass(/connection-status--load-failed/);

        // Step 5: Verify editing is blocked
        // Sticky note button should be disabled
        const stickyBtn = brokenPage.getByRole('button', { name: /sticky note/i });
        await expect(stickyBtn).toBeDisabled();

        // Dbl-click should NOT create a note
        await brokenPage.mouse.dblclick(500, 400);
        await new Promise((r) => setTimeout(r, 500));
        // No sticky-textarea should appear
        const textarea = brokenPage.locator('[data-testid="sticky-textarea"]');
        await expect(textarea).toHaveCount(0);

        // Step 6: Repair the board
        await repairBoard(server2.url, boardId);

        // Step 7: Wait for retry (LOAD_RETRY_MIN_INTERVAL_MS + buffer)
        await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 2000));

        // Step 8: Board should now load (badge goes away)
        await expect(badge).toBeHidden({ timeout: 15000 });

        // Notes should be present
        await expect(brokenPage.locator('[data-testid^="sticky-note-"]')).toHaveCount(5, { timeout: 10000 });

        // Step 9: Editing works without reload
        const stickyBtn2 = brokenPage.getByRole('button', { name: /sticky note/i });
        await expect(stickyBtn2).toBeEnabled();

        await brokenPage.mouse.dblclick(600, 400);
        await brokenPage.locator('[data-testid="sticky-textarea"]').waitFor({ timeout: 5000 });
        await expect(brokenPage.locator('[data-testid^="sticky-note-"]')).toHaveCount(6, { timeout: 5000 });

        await brokenCtx.close();
      } finally {
        await server2.stop();
      }
    } catch (e) {
      try { await server.stop(); } catch {}
      throw e;
    }
  });
});
