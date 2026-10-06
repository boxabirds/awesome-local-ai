/**
 * Paste an unknown link → not found page (TC-27).
 *
 * Navigates to /b/<valid but never-created id> and verifies the "Board not found" heading appears.
 */
import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';

test.describe('open an unknown board link', () => {
  test('TC-27: /b/<never-created valid id> shows "Board not found"', async ({ page }) => {
    const id = newBoardId();
    await page.goto(`/b/${id}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    expect(await page.textContent('h1')).toContain('Board not found');
  });
});
