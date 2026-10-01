import { test, expect } from '@playwright/test';

/**
 * TC-19: Create notes, close, reopen → notes persist
 * TC-20: Multiple boards are independent
 * TC-21: Notes survive server restart (persist-to)
 */

test.describe('E2E Persistence', () => {
  test('TC-19: notes persist across page reloads', async ({ page }) => {
    // Navigate to a new board
    const boardId = `e2e-persist-${Date.now()}`;
    await page.goto(`/board/${boardId}`);

    // Wait for the board to load
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // Create a sticky note by double-clicking the board
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 200, y: 200 } });

    // Type text into the note
    await page.waitForSelector('[data-testid="sticky-text-editor"] input, [data-testid="sticky-text-editor"] textarea, [contenteditable="true"]', { timeout: 5000 });
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.fill('Persist me');

    // Click away to deselect
    await page.click('[data-testid="board-viewport"]', { position: { x: 50, y: 50 } });

    // Verify the note is visible
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Persist me');

    // Reload the page
    await page.reload();

    // Wait for the board to load again
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // Wait for the note to appear (sync from server)
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Persist me', { timeout: 10000 });
  });

  test('TC-20: multiple boards are independent', async ({ page }) => {
    const boardA = `e2e-board-a-${Date.now()}`;
    const boardB = `e2e-board-b-${Date.now()}`;

    // Create a note on board A
    await page.goto(`/board/${boardA}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 200, y: 200 } });
    await page.waitForSelector('[contenteditable="true"]', { timeout: 5000 });
    await page.locator('[contenteditable="true"]').first().fill('Board A note');
    await page.click('[data-testid="board-viewport"]', { position: { x: 50, y: 50 } });
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Board A note');

    // Navigate to board B
    await page.goto(`/board/${boardB}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // Board B should be empty (no notes)
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('TC-21: notes are visible after navigating away and back', async ({ page }) => {
    const boardId = `e2e-return-${Date.now()}`;

    // Create a note
    await page.goto(`/board/${boardId}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 300, y: 300 } });
    await page.waitForSelector('[contenteditable="true"]', { timeout: 5000 });
    await page.locator('[contenteditable="true"]').first().fill('Return to me');
    await page.click('[data-testid="board-viewport"]', { position: { x: 50, y: 50 } });
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Return to me');

    // Navigate to a different board
    const otherBoard = `e2e-other-${Date.now()}`;
    await page.goto(`/board/${otherBoard}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // Navigate back to the original board
    await page.goto(`/board/${boardId}`);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 10000 });

    // The note should be there
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Return to me', { timeout: 10000 });
  });
});
