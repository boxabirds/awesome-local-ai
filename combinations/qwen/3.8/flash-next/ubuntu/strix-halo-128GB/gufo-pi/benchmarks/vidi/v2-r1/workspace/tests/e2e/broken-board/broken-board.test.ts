/**
 * E2E broken board test (TC-24):
 * board created, snapshot corrupted via test hook, reload shows load-failed badge,
 * Sticky note button is disabled, after repair a fresh reload shows notes intact.
 */

import { test, expect } from '@playwright/test';
import { dblclickCreate } from '../helpers/stickies';
import {
  openBoard,
  getNoteCount,
  waitForLoadFailed,
  waitForStatusBadge,
  forceCompaction,
  corruptSnapshot,
  repairSnapshot,
} from '../helpers/persistence';

async function waitForNotes(page: import('@playwright/test').Page, n: number): Promise<void> {
  await page.waitForFunction(
    (count) => (window.__vidi6?.getNoteCount?.() ?? -1) === count,
    n,
    { timeout: 15_000 },
  );
}

test('TC-24: broken board shows load-failed badge, editing disabled, repair recovers', async ({ browser }) => {
  // Step 1: Create a board with notes
  const page1 = await browser.newPage();
  const boardId = await openBoard(page1);

  await dblclickCreate(page1, { x: 300, y: 300 });
  await page1.keyboard.type('note one');
  await page1.keyboard.press('Escape');
  await waitForNotes(page1, 1);

  await dblclickCreate(page1, { x: 500, y: 400 });
  await page1.keyboard.type('note two');
  await page1.keyboard.press('Escape');
  await waitForNotes(page1, 2);

  await page1.waitForTimeout(500);
  await page1.close();

  // Force compaction to create a snapshot
  await forceCompaction(boardId);

  // Step 2: Corrupt the snapshot via test hook
  await corruptSnapshot(boardId);

  // Step 3: Reload the page with the same board id - should show load-failed badge
  const page2 = await browser.newPage();
  await page2.goto(`/b/${boardId}`);
  await expect(page2.getByTestId('viewport')).toBeVisible();

  // Wait for load_failed state
  await waitForLoadFailed(page2);
  await waitForStatusBadge(page2, "This board couldn't be loaded. Retrying…");

  // Verify the Sticky note button is disabled
  const stickyButton = page2.getByTestId('create-sticky');
  await expect(stickyButton).toBeDisabled();

  // Verify no notes are rendered (board is empty since we couldn't load)
  await page2.waitForTimeout(1000);
  const noteCountResult = await page2.locator('[data-testid="sticky-note"]').count();
  expect(noteCountResult).toBe(0);

  await page2.close();

  // Step 4: Repair the snapshot
  await repairSnapshot(boardId);

  // Step 5: Fresh reload should show notes intact
  const page3 = await browser.newPage();
  await openBoard(page3, boardId);
  await waitForNotes(page3, 2);

  const count = await getNoteCount(page3);
  expect(count).toBe(2);

  // Verify the Sticky button is now enabled
  const stickyBtn = page3.getByTestId('create-sticky');
  await expect(stickyBtn).toBeEnabled();

  await page3.close();
});
