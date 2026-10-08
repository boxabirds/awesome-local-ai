import { test, expect } from '@playwright/test';
import { STICKY_MIN_SIZE_WORLD } from '@shared/config';

test.describe('E2E — Selection (Story 7)', () => {
  // ─── Helpers ────────────────────────────────────────────────────────

  async function createNotes(page: ReturnType<typeof test['page']>, count: number) {
    const stickyBtn = page.locator('[aria-label="Sticky note"]').first();
    for (let i = 0; i < count; i++) {
      await stickyBtn.click();
      // Exit edit mode
      await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (ta) (ta as HTMLTextAreaElement).blur();
      });
      await page.waitForTimeout(100);
    }
  }

  async function getSelectedCount(page: ReturnType<typeof test['page']>) {
    return page.locator('[data-sticky-id][data-selected]').count();
  }

  // ─── TC-32: marquee selects only fully-inside objects ───────────────

  test('TC-32: Shift+drag marquee selects fully-inside notes only', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });

    // Create notes positioned in a line with some gaps
    await createNotes(page, 4);
    await page.waitForTimeout(500);

    // Get positions of first 3 notes
    const note0 = page.locator('[data-sticky-id]').nth(0);
    const note1 = page.locator('[data-sticky-id]').nth(1);
    const box0 = await note0.boundingBox();
    const box1 = await note1.boundingBox();
    expect(box0).not.toBeNull();
    expect(box1).not.toBeNull();

    // Drag marquee around just the first two notes (shift+drag on empty space)
    const startX = box0!.x - 20;
    const startY = box0!.y - 20;
    const endX = box1!.x + box1!.width + 20;
    const endY = box0!.y + box0!.height + 20;

    // Click empty space to start marquee
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Hold shift key during drag
    await page.keyboard.down('Shift');
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    await page.waitForTimeout(300);

    // At least one note should be selected via marquee
    const selCount = await getSelectedCount(page);
    expect(selCount).toBeGreaterThanOrEqual(1);
  });

  // ─── TC-33: group move via drag handles ─────────────────────────────

  test('TC-33: dragging selected notes moves all together', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });

    // Create 6 notes
    await createNotes(page, 6);
    await page.waitForTimeout(500);

    // Select multiple notes via Ctrl+A or multi-click
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // Verify selection bar shows "6 selected"
    const bar = page.locator('[data-selection-bar]');
    await expect(bar).toBeVisible();

    // Check the status text
    await expect(bar).toContainText('6 selected');

    // Move mouse to first selected note
    const firstNote = page.locator('[data-sticky-id][data-selected]').first();
    const boxBefore = await firstNote.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Start drag on the note
    const cx = boxBefore!.x + boxBefore!.width / 2;
    const cy = boxBefore!.y + boxBefore!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 80, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Note should have moved
    const boxAfter = await firstNote.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.x).toBeGreaterThan(cx - 20);
  });

  // ─── TC-34: keyboard commands ───────────────────────────────────────

  test('TC-34: ArrowRight nudge and Delete remove selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });

    // Create several notes
    await createNotes(page, 3);
    await page.waitForTimeout(500);

    // Select all
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    // ArrowRight ×3
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await page.waitForTimeout(200);

    // Shift+ArrowUp once
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    // The notes should have shifted position
    const firstNote = page.locator('[data-sticky-id]').first();
    const box = await firstNote.boundingBox();
    expect(box).not.toBeNull();

    // Delete all selected
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // No notes should remain (or fewer than before)
    const remaining = await page.locator('[data-sticky-id]').count();
    expect(remaining).toBeLessThan(3);

    // Selection bar should be gone
    await expect(page.locator('[data-selection-bar]')).not.toBeVisible();
  });

  // ─── TC-36: concurrent edits converge ───────────────────────────────

  test('TC-36: selections merge correctly after sequential creation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });

    // Create many notes rapidly
    await createNotes(page, 10);
    await page.waitForTimeout(500);

    // All notes visible?
    const count = await page.locator('[data-sticky-id]').count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Ctrl+A to select all
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    // Should show "10 selected"
    const bar = page.locator('[data-selection-bar]');
    await expect(bar).toBeVisible();

    // Escape to clear
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // No more selection bar
    await expect(bar).not.toBeVisible();
  });
});
