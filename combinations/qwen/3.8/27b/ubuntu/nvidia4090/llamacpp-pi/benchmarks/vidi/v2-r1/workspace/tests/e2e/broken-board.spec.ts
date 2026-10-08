// E2E (story 4, task 9): a board whose snapshot is unreadable shows the red
// "couldn't be loaded" banner with the edit affordances locked, and recovers
// in place (no page reload) once storage is repaired (TC-24; TC-25 budget).

import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BUDGET_RECOVERY_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';
import { generateLargeBoardUpdate } from '../fixtures/boards';
import { createWranglerProcess, testHook } from './wrangler-process';

const STICKY_COUNT_SELECTOR = '[data-testid="sticky-note"]';
const BANNER = { name: 'Board load failed' } as const;

/** Wait until the page's test hooks are installed. */
async function waitForHooks(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => (window as { __vidi6?: unknown }).__vidi6 !== undefined, null, {
    timeout: 15_000,
  });
}

test('TC-24: a broken board shows the red banner and recovers without a reload', async ({ browser }) => {
  const wrangler = await createWranglerProcess();
  try {
    await wrangler.start();
    const boardId = newBoardId();

    // A 25-note board with a compacted snapshot, then corrupt the snapshot
    // on disk and force the room to reload from storage (a new instance —
    // e.g. after hibernation — would do this for real).
    const update = generateLargeBoardUpdate(42, 25);
    expect((await testHook(boardId, 'seed', update)).status).toBe(200);
    expect((await testHook(boardId, 'compact')).status).toBe(200);
    expect((await testHook(boardId, 'corrupt-snapshot')).status).toBe(200);
    const reloaded = await testHook(boardId, 'reload');
    expect(reloaded.status).toBe(200);
    expect(((await reloaded.json()) as { state: string }).state).toBe('load-failed');

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);
    await waitForHooks(page);

    // The red banner is visible and the edit affordance is locked while the
    // board cannot be loaded.
    const banner = page.getByRole('status', BANNER);
    await expect(banner).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(banner).toContainText("This board couldn't be loaded. Retrying…");
    await expect(page.getByRole('button', { name: 'Sticky note (N)' })).toBeDisabled();
    await expect(page.locator(STICKY_COUNT_SELECTOR)).toHaveCount(0);

    // Repair the snapshot. The provider's own retry must load the board in
    // place — no page reload.
    const repairAt = Date.now();
    expect((await testHook(boardId, 'repair')).status).toBe(200);

    await expect(banner).toBeHidden({ timeout: 2 * E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: 'Sticky note (N)' })).toBeEnabled();
    await expect(page.locator(STICKY_COUNT_SELECTOR)).toHaveCount(25, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    const recoveryMs = Date.now() - repairAt;
    console.log(
      `[TC-25] repair → recovered in ${recoveryMs}ms (budget ${BUDGET_RECOVERY_MS}ms, reported only)`,
    );

    // Editing is genuinely re-enabled in the recovered board.
    const created = await page.evaluate(() =>
      (window as { __vidi6: { createNoteAt: (x: number, y: number, c: string, t: string) => string | null } }).__vidi6
        .createNoteAt(100, 100, 'yellow', 'back'),
    );
    expect(created).not.toBeNull();
    await expect(page.locator(STICKY_COUNT_SELECTOR)).toHaveCount(26, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    await ctx.close();
  } finally {
    await wrangler.dispose();
  }
});
