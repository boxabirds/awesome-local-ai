import { test, expect } from '@playwright/test';
import { openSharedBoard, createSticky, noteTexts, noteCount } from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config.ts';

test.describe('supplemental: two tabs in one browser share the board with no duplicates', () => {
  // BroadcastChannel is disabled in connectBoard, so the room is the single
  // relay even for same-browser tabs. (Not the nightly capacity soak, design
  // TC-30 — see tests/e2e/nightly.)
  test('both tabs see each other and notes are not duplicated', async ({ context }) => {
    const id = newBoardId();
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await openSharedBoard(tabA, id);
    await openSharedBoard(tabB, id);

    await createSticky(tabA, 400, 300, 'from-a');
    await expect
      .poll(() => noteTexts(tabB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toEqual(['from-a']);

    await createSticky(tabB, 650, 350, 'from-b');
    await expect
      .poll(() => noteTexts(tabA), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toEqual(['from-a', 'from-b']);

    // Both tabs converge on exactly two notes — no duplicates from the shared
    // browser (BroadcastChannel is disabled; the room is the single relay).
    await expect
      .poll(() => noteCount(tabB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(2);
    expect(await noteCount(tabA)).toBe(2);
  });
});
