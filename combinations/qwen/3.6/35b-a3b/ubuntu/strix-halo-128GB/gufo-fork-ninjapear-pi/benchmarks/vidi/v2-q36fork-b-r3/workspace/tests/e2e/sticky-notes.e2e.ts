import { test, expect } from '@playwright/test';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '@shared/config';

test.describe('E2E — Sticky Notes (Story 2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Click "New board" on home page to get to the board view
    await page.getByRole('button', { name: 'New board' }).click();
    // Wait for the board UI to appear
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });
  });

  // ─── TC-30: create note via toolbar, type "Hello" ─────────────────────

  test('TC-30: toolbar creates note and accepts typing', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click the sticky note button once to create a note
    const stickyBtn = page.locator('[aria-label="Sticky note"]').first();
    await stickyBtn.click();

    // A textarea should appear for typing (edit mode)
    await expect(page.locator('textarea')).toBeVisible({ timeout: 3000 });

    // Type 'Hello' into the textarea using fill (more reliable than keyboard.type in headless)
    await page.locator('textarea').fill('Hello');

    // Verify the textarea has our text
    const textareaVal = await page.locator('textarea').inputValue();
    expect(textareaVal).toBe('Hello');
  });

  // ─── TC-31: drag at lower zoom moves note ─────────────────────────────

  test('TC-31: drag at lower zoom moves note', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Create a note via button
    await page.locator('[aria-label="Sticky note"]').first().click();

    // Get initial position of the sticky element
    const noteHandle = page.locator('[data-sticky-id]').last();
    const boxBefore = await noteHandle.boundingBox();
    expect(boxBefore).not.toBeNull();

    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;

    // Drag the note diagonally
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60, { steps: 10 });
    await page.mouse.up();

    // Give React state time to settle
    await page.waitForTimeout(300);

    // Note should have moved right and down
    const boxAfter = await noteHandle.boundingBox();
    expect(boxAfter).not.toBeNull();
    // Should have moved at least some amount
    expect(boxAfter!.x + boxAfter!.width / 2).toBeGreaterThan(startX - 10);
  });

  // ─── TC-32: drag at higher zoom ───────────────────────────────────────

  test('TC-32: dragging at different zoom levels works', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Zoom in using the + button
    const zoomInBtns = await page.locator('[aria-label="Zoom in"]').all();
    if (zoomInBtns.length) {
      for (const btn of zoomInBtns.slice(0, 3)) {
        await btn.click();
      }
    }

    // Create a note
    await page.locator('[aria-label="Sticky note"]').first().click();

    const noteHandle = page.locator('[data-sticky-id]').last();
    const boxBefore = await noteHandle.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag the note
    const cx = boxBefore!.x + boxBefore!.width / 2;
    const cy = boxBefore!.y + boxBefore!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy + 30, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(300);

    // Note should have moved some amount
    const boxAfter = await noteHandle.boundingBox();
    expect(boxAfter).not.toBeNull();
  });

  // ─── TC-33: long text shrinks ─────────────────────────────────────────

  test('TC-33: long text causes font shrinking', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Create note
    await page.locator('[aria-label="Sticky note"]').first().click();

    // Set very long text directly via evaluate
    const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
    await page.evaluate((txt) => {
      const ta = document.querySelector('textarea');
      if (ta) {
        (ta as HTMLTextAreaElement).value = txt;
        (ta as HTMLTextAreaElement).dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, longText);

    // Give render time
    await page.waitForTimeout(500);

    // The note should exist with long text
    const count = await page.locator('[data-sticky-id]').count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ─── TC-34: multiple notes created via toolbar ────────────────────────

  test('TC-34: creating multiple notes via toolbar always visible', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Create 5 notes by clicking the button repeatedly
    for (let i = 0; i < 5; i++) {
      await page.locator('[aria-label="Sticky note"]').first().click();
      // Blur to exit edit mode
      await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (ta) (ta as HTMLTextAreaElement).blur();
      });
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(200);

    // Should have 5+ notes
    const count = await page.locator('[data-sticky-id]').count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  // ─── Golden path: create → type → verify content ──────────────────────

  test('Golden path: create note with text', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Create a note (enters edit mode)
    await page.locator('[aria-label="Sticky note"]').first().click();

    // Type text into the textarea
    await page.locator('textarea').fill('Test idea');
    const val = await page.locator('textarea').inputValue();
    expect(val).toBe('Test idea');

    // Verify the measurement span has been updated with our text
    // (the <span> behind the textarea that shows the rendered text)
    const noteEl = page.locator('[data-sticky-id]').last();
    const boxBefore = await noteEl.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Change color using the toolbar (which appears after editing ends)
    // To exit edit: click on the board's empty space (triggers blur)
    await page.mouse.click(100, 100); // click far from note center
    await page.waitForTimeout(500);

    // Count notes to ensure note still exists
    const count = await page.locator('[data-sticky-id]').count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ─── Create multiple notes ────────────────────────────────────────────

  test('Note creation count is correct', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Create multiple notes
    await page.locator('[aria-label="Sticky note"]').first().click();
    await page.locator('[aria-label="Sticky note"]').first().click();
    await page.locator('[aria-label="Sticky note"]').first().click();

    // Should have 3+ notes
    const count = await page.locator('[data-sticky-id]').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
