/** E2E tests for Story 5 — Share a board with others using a link
 * Covers: TC-37, TC-38, TC-39
 */

import { test, expect } from '@playwright/test';

test.describe('E2E — Share Board (Story 5)', () => {
  // ─── TC-37: Share panel → copy link → new tab loads same board ──────
  test('TC-37: share panel generates correct link that loads in new tab', async ({ browser }) => {
    // Open first browser context (user 1)
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    
    // Go to home and create a new board
    await page1.goto('/');
    await page1.getByRole('button', { name: 'New board' }).click();
    
    // Wait for board to load
    await expect(page1.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 5000 });
    
    // Get the current URL (contains the board ID)
    const boardUrl = page1.url();
    
    // Click the Share button
    await page1.getByRole('button', { name: 'Share' }).click();
    
    // Verify the board link input contains the expected URL pattern
    const linkInput = page1.getByLabelText('Board link');
    await expect(linkInput).toBeVisible();
    
    // The link should end with the board path
    const linkValue = await linkInput.inputValue();
    expect(linkValue).toMatch(/\/b\/[A-Za-z0-9_-]+$/);
    
    // Close first context
    await context1.close();
    
    // Open second browser context (simulating another user visiting shared link)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    
    // Navigate to the board URL
    await page2.goto(boardUrl);
    
    // Should show the board UI directly (not home page, not not found)
    await expect(page2.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 10000 });
    
    // The share button should be present
    await expect(page2.getByRole('button', { name: 'Share' })).toBeVisible();
    
    await context2.close();
  });

  // ─── TC-38: Home page shows product info and New board button ───────
  test('TC-38: home page shows product name, tagline, and New board button', async ({ page }) => {
    await page.goto('/');
    
    // Product title should be visible
    await expect(page.locator('h1')).toBeVisible();
    
    // Tagline should be present
    await expect(page.getByText(/share /i)).toBeVisible({ timeout: 5000 });
    
    // New board button should be visible and enabled
    const newBoardBtn = page.getByRole('button', { name: 'New board' });
    await expect(newBoardBtn).toBeVisible();
    await expect(newBoardBtn).toBeEnabled();
    
    // Clicking it should navigate to a board
    await newBoardBtn.click();
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 5000 });
  });

  // ─── TC-39: Invalid board id shows not found page ───────────────────
  test('TC-39: navigating to unknown board shows not found with back to home', async ({ page }) => {
    // Generate a fresh valid board id that doesn't exist
    const freshId = await page.evaluate(() => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
        .slice(0, 22);
    });
    
    await page.goto(`/b/${freshId}`);
    
    // Should show "Board not found"
    await expect(page.getByText('Board not found')).toBeVisible({ timeout: 10000 });
    
    // Should have a "New board" button to go back home
    const newBoardBtn = page.getByRole('button', { name: 'New board' });
    await expect(newBoardBtn).toBeVisible();
    
    // Clicking it should go to home
    await newBoardBtn.click();
    await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
    expect(page.url()).toMatch(/\/$/);
  });
});
