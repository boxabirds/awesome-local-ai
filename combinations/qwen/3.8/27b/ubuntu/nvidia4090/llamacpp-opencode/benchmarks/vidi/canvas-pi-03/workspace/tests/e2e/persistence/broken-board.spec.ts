import { test, expect } from '@playwright/test';
import { newBoardId, openBoard, closeAll } from '../participants';
import { WranglerProcess } from './wrangler-process';
import { buildBoardUpdates } from './boards';
import { seedBoard, getBoardNotes, waitForNoteCount, hook } from './helpers';

/** Mirrors LOAD_RETRY_MIN_INTERVAL_MS (src/shared/config). */
const RETRY_INTERVAL_MS = 5000;

/**
 * Story 4 e2e (TC-24): a board whose snapshot is unreadable shows the failed
 * state (red badge + edit lock), and once the storage is repaired the SAME
 * page recovers without a manual reload — the room retries its load once the
 * retry interval has elapsed.
 */
test('TC-24: broken board shows the failed state, then recovers without a reload', async ({ browser }) => {
  const wrangler = new WranglerProcess();
  await wrangler.start();
  const boardId = newBoardId();
  const COUNT = 5;
  try {
    // Build a board and compact it so its durable state is a snapshot.
    const p = await openBoard(browser, boardId);
    await seedBoard(p.page, buildBoardUpdates(COUNT, 0x0bad).updates);
    await waitForNoteCount(p.page, COUNT);
    const compact = await hook(wrangler.url, boardId, 'store-compact', { force: true });
    expect(compact.json.compacted).toBe(true);
    await closeAll(p);

    // Corrupt the snapshot, then forget memory: the next open must load it.
    const corrupt = await hook(wrangler.url, boardId, 'corrupt-snapshot', { idx: 0 });
    expect(corrupt.json.ok).toBe(true);
    await wrangler.restart();

    // Open: the board fails to load → persistent red badge + edit lock.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);
    const badge = page.locator('[data-testid="connection-status"]');
    await expect(badge, 'failed-load badge visible').toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await badge.textContent())?.trim(), { timeout: 20_000 })
      .toBe("This board couldn't be loaded. Retrying…");
    const sticky = page.locator('[data-testid="sticky-button"]');
    await expect(sticky, 'edits locked while load failed').toBeDisabled({ timeout: 20_000 });

    // Repair the storage. The open page keeps reconnecting; once the retry
    // interval has passed since the failed load the room re-loads (now clean)
    // and the board appears WITHOUT a manual reload.
    const repair = await hook(wrangler.url, boardId, 'repair');
    expect(repair.json.repairedSnapshot).toBe(1);

    await expect
      .poll(
        async () => (await getBoardNotes(page)).length,
        { timeout: RETRY_INTERVAL_MS + 12_000, message: 'board recovers after repair, no manual reload' },
      )
      .toBe(COUNT);
    await expect(badge, 'badge clears on recovery').toBeHidden({ timeout: 10_000 });
    await expect(sticky, 'edits unlocked on recovery').toBeEnabled({ timeout: 10_000 });
    await ctx.close();
  } finally {
    await wrangler.stop();
  }
});
