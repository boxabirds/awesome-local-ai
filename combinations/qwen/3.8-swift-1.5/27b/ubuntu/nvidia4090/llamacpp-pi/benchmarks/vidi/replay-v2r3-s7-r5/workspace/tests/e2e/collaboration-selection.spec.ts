import { test, expect } from '@playwright/test';
import { createBoard, openBoardInPage, seedNotes } from './helpers/board';
import { setCamera, shiftDrag, isSelected, noteLocator } from './helpers/selection';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Story 7 TC-35 (sel.interaction, prune through the real sync path):
 * Lee multi-selects 4 notes; Sam deletes one of them; Lee's selection is
 * pruned live (count drops, outlines survive on the rest), and a subsequent
 * Delete removes exactly the remaining selected notes.
 */
test.describe('TC-35: colleague deletes one of my selected notes', () => {
  test('Lee\'s selection is pruned live when Sam deletes one of the 4', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxLee = await browser.newContext();
    const ctxSam = await browser.newContext();
    const lee = await ctxLee.newPage();
    const sam = await ctxSam.newPage();
    await openBoardInPage(lee, boardId);
    await openBoardInPage(sam, boardId);
    await lee.waitForFunction(() => !!(window as any).__VIDI_DEBUG__?.doc);
    await sam.waitForFunction(() => !!(window as any).__VIDI_DEBUG__?.doc);
    await setCamera(lee, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });

    // 20-note fixture: two 5×4 clusters (here one 5×4 grid, 50-unit gaps).
    const notes: { x: number; y: number; text?: string }[] = [];
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 4; r++) {
        notes.push({ x: 100 + c * 250, y: 100 + r * 250, text: `Idea ${c * 4 + r + 1}` });
      }
    }
    const ids = await seedNotes(lee, notes);
    await expect(lee.locator('[data-testid^="sticky-note-"]'), 'lee sees 20').toHaveCount(20, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(sam.locator('[data-testid^="sticky-note-"]'), 'sam sees 20').toHaveCount(20, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Lee shift-drags a 2×2 block: ids[0], ids[1], ids[4], ids[5].
    await shiftDrag(lee, 80, 80, 570, 570);
    await expect(lee.getByTestId('selection-count')).toHaveText('4 selected');

    // Sam selects one of those (ids[5]) and deletes it.
    const targetId = ids[5];
    const target = noteLocator(sam, targetId);
    const box = (await target.boundingBox())!;
    await sam.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const start = Date.now();
    await sam.keyboard.press('Delete');

    // Lee: the count drops to 3 within the latency budget…
    await expect(lee.getByTestId('selection-count')).toHaveText('3 selected', {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS + 150);
    // …the deleted note is gone from Lee's board…
    await expect(noteLocator(lee, targetId)).toHaveCount(0);
    // …and the other 3 keep their outlines.
    for (const id of [ids[0], ids[1], ids[4]]) {
      expect(await isSelected(lee, id)).toBe(true);
    }

    // Lee presses Delete → exactly those 3 are removed (16 remain).
    await lee.keyboard.press('Delete');
    await expect(lee.locator('[data-testid^="sticky-note-"]')).toHaveCount(16);
    for (const id of [ids[0], ids[1], ids[4]]) {
      await expect(noteLocator(lee, id)).toHaveCount(0);
    }

    await ctxLee.close();
    await ctxSam.close();
  });
});
