import { test, expect } from '@playwright/test';
import { createBoard, setCamera } from './helpers/board';

/**
 * TC-19: Create notes, close, reopen → notes persist
 * TC-20: Multiple boards are independent
 * TC-21: Notes survive navigating away and back
 */

async function gotoBoard(page: any, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
}

async function createNote(page: any, x: number, y: number, text: string): Promise<void> {
  await page.dblclick('[data-testid="board-viewport"]', { position: { x, y } });
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor({ timeout: 5000 });
  await editor.fill(text);
  await page.click('[data-testid="board-viewport"]', { position: { x: 50, y: 50 } });
}

test.describe('E2E Persistence', () => {
  test('TC-19: notes persist across page reloads', async ({ page }) => {
    const boardId = await createBoard();
    await gotoBoard(page, boardId);

    await createNote(page, 200, 200, 'Persist me');
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Persist me');

    // Reload the page → the note is re-synced from the server.
    await page.reload();
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Persist me', { timeout: 15000 });
  });

  test('TC-20: multiple boards are independent', async ({ page }) => {
    const boardA = await createBoard();
    const boardB = await createBoard();

    await gotoBoard(page, boardA);
    await createNote(page, 200, 200, 'Board A note');
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Board A note');

    // Navigate to board B → it is empty.
    await gotoBoard(page, boardB);
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('TC-21: notes are visible after navigating away and back', async ({ page }) => {
    const boardId = await createBoard();
    const otherBoard = await createBoard();

    await gotoBoard(page, boardId);
    await createNote(page, 300, 300, 'Return to me');
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Return to me');

    // Navigate to a different board, then back.
    await gotoBoard(page, otherBoard);
    await gotoBoard(page, boardId);
    await expect(page.locator('[data-testid="sticky-text-display"]')).toContainText('Return to me', { timeout: 15000 });
  });
});
