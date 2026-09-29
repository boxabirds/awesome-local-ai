/**
 * E2E persistence tests: data survives simulated DO eviction (TC-19 to TC-21).
 */

import { test, expect } from '@playwright/test';
import { dblclickCreate } from '../helpers/stickies';
import {
  openBoard,
  getNoteCount,
  getStorageStats,
  resetState,
} from '../helpers/persistence';

async function waitForNotes(page: import('@playwright/test').Page, n: number): Promise<void> {
  await page.waitForFunction(
    (count) => (window.__vidi6?.getNoteCount?.() ?? -1) === count,
    n,
    { timeout: 15_000 },
  );
}

test('TC-19: two notes survive simulated DO restart', async ({ browser }) => {
  // Session 1: create two notes
  const page1 = await browser.newPage();
  const boardId = await openBoard(page1);

  await dblclickCreate(page1, { x: 300, y: 300 });
  await page1.keyboard.type('first');
  await page1.keyboard.press('Escape');
  await waitForNotes(page1, 1);

  await dblclickCreate(page1, { x: 500, y: 400 });
  await page1.keyboard.type('second');
  await page1.keyboard.press('Escape');
  await waitForNotes(page1, 2);

  // Wait for updates to be committed
  await page1.waitForTimeout(500);

  // Close page (all clients leave)
  await page1.close();

  // Simulate DO eviction
  await resetState(boardId);

  // Session 2: open a new page with the same board id
  const page2 = await browser.newPage();
  await openBoard(page2, boardId);
  await waitForNotes(page2, 2);

  const count = await getNoteCount(page2);
  expect(count).toBe(2);

  await page2.close();
});

test('TC-20: 2000 notes survive simulated DO restart', async ({ browser }) => {
  // Session 1: create 2000 notes via the test hook
  const page1 = await browser.newPage();
  const boardId = await openBoard(page1);

  await page1.evaluate(() => window.__vidi6?.addRandomNotes?.(2000));
  await waitForNotes(page1, 2000);

  // Wait for storage to commit
  await page1.waitForTimeout(2000);

  // Verify the note count via storage stats
  const stats = await getStorageStats(boardId);
  expect(stats.updateCount + stats.snapshotChunkCount).toBeGreaterThan(0);

  // Close page (all clients leave)
  await page1.close();

  // Simulate DO eviction
  await resetState(boardId);

  // Session 2: open a new page with the same board id
  const page2 = await browser.newPage();
  await openBoard(page2, boardId);
  await waitForNotes(page2, 2000);

  const count = await getNoteCount(page2);
  expect(count).toBe(2000);

  await page2.close();
});

test('TC-21: update log exceeds compaction threshold → old updates cleared', async ({ browser }) => {
  const page = await browser.newPage();
  const boardId = await openBoard(page);

  // Create many notes to trigger compaction (COMPACTION_UPDATE_COUNT = 500)
  await page.evaluate(() => window.__vidi6?.addRandomNotes?.(2000));
  await waitForNotes(page, 2000);

  // Wait for compaction to happen (it's triggered synchronously after append)
  await page.waitForTimeout(2000);

  // Check storage stats: after compaction, update count should be low
  const stats = await getStorageStats(boardId);
  expect(stats.snapshotChunkCount).toBeGreaterThan(0);
  expect(stats.updateCount).toBeLessThan(2000);

  // Data integrity: after compaction, a reload should still show 2000 notes
  await page.close();
  await resetState(boardId);

  const page2 = await browser.newPage();
  await openBoard(page2, boardId);
  await waitForNotes(page2, 2000);

  const count = await getNoteCount(page2);
  expect(count).toBe(2000);

  await page2.close();
});
