import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';

test.describe('Story 5: Share a board with others using a link', () => {
  test.describe('Workflow: Create and share', () => {
    test('TC-26: Maya creates board, adds note, copies link; Sam opens link and sees note', async ({ browser }) => {
      // Maya's context
      const mayaCtx = await browser.newContext();
      const maya = await mayaCtx.newPage();
      
      // Maya navigates to home and creates a board
      await maya.goto('/');
      await maya.getByRole('button', { name: 'New board' }).click();
      
      // Wait for board to load (URL changes to /b/<id>)
      await maya.waitForURL(/\/b\//);
      const boardUrl = maya.url();
      
      // Wait for the board to be ready (viewport visible)
      await expect(maya.getByTestId('board-viewport')).toBeVisible();
      
      // Maya adds a note by double-clicking
      const viewport = maya.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      if (!box) throw new Error('Viewport not found');
      
      await maya.dblclick('[data-testid="board-viewport"]', { position: { x: 300, y: 300 } });
      
      // Type text in the note
      await maya.keyboard.type('Hello from Maya');
      await maya.keyboard.press('Escape');
      
      // Verify note is visible
      await expect(maya.locator('[data-testid="sticky-note"]')).toHaveCount(1);
      
      // Maya copies the link using the Share panel
      await maya.getByRole('button', { name: 'Share' }).click();
      await expect(maya.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      
      // Get the link from the input
      const linkInput = maya.getByRole('textbox', { name: 'Board link' });
      const linkValue = await linkInput.inputValue();
      expect(linkValue).toBe(boardUrl);
      
      // Close the share panel
      await maya.keyboard.press('Escape');
      
      // Sam's context - opens the shared link
      const samCtx = await browser.newContext();
      const sam = await samCtx.newPage();
      
      // Sam opens the board link
      await sam.goto(linkValue);
      
      // Sam should see the board with Maya's note
      await expect(sam.getByTestId('board-viewport')).toBeVisible();
      await expect(sam.locator('[data-testid="sticky-note"]')).toHaveCount(1);
      
      // Sam can see the note text
      await expect(sam.locator('[data-testid="sticky-note"]')).toContainText('Hello from Maya');
      
      // Sam adds a note
      const samViewport = sam.getByTestId('board-viewport');
      const samBox = await samViewport.boundingBox();
      if (!samBox) throw new Error('Sam viewport not found');
      
      await sam.dblclick('[data-testid="board-viewport"]', { position: { x: 500, y: 300 } });
      await sam.keyboard.type('Hello from Sam');
      await sam.keyboard.press('Escape');
      
      // Sam sees 2 notes
      await expect(sam.locator('[data-testid="sticky-note"]')).toHaveCount(2);
      
      // Maya sees Sam's note (live collaboration)
      await expect(maya.locator('[data-testid="sticky-note"]')).toHaveCount(2);
      
      await mayaCtx.close();
      await samCtx.close();
    });

    test('TC-27: Open unknown board link shows NotFound; New board creates empty board', async ({ page }) => {
      // Generate a valid but never-created board id
      const unknownId = newBoardId();
      
      // Open the unknown board link
      await page.goto(`/b/${unknownId}`);
      
      // Should show "Board not found"
      await expect(page.getByText('Board not found')).toBeVisible();
      
      // Click "New board" to create a new board
      await page.getByRole('button', { name: 'New board' }).click();
      
      // Should navigate to a new board
      await page.waitForURL(/\/b\//);
      const newUrl = page.url();
      
      // The new board id should be different from the unknown one
      const newId = new URL(newUrl).pathname.slice(3);
      expect(newId).not.toBe(unknownId);
      
      // The new board should be empty (no notes)
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
    });

    test('TC-28: Unreachable service shows retry; recovers without reload', async ({ page }) => {
      // Create a board first
      await page.goto('/');
      await page.getByRole('button', { name: 'New board' }).click();
      await page.waitForURL(/\/b\//);
      const boardUrl = page.url();
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      
      // Now navigate to the same board with the API blocked
      // We'll use a new page to test the retry behavior
      const browser = page.context().browser();
      if (!browser) throw new Error('No browser');
      const newPage = await browser.newPage();
      
      // Block the board check API
      await newPage.route('/api/boards/**', (route: import('@playwright/test').Route) => route.abort());
      
      // Navigate to the board
      await newPage.goto(boardUrl);
      
      // Should show "Opening board…" then "Couldn't reach vidi6. Retrying…"
      // The initial check fails, so we should see the retry message
      await expect(newPage.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({ timeout: 10000 });
      
      // Unblock the API
      await newPage.unroute('/api/boards/**');
      
      // The board should eventually load without a page reload
      await expect(newPage.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
      
      await newPage.close();
    });

    test('TC-29: Clipboard denied shows manual-copy fallback', async ({ page }) => {
      // Create a board
      await page.goto('/');
      await page.getByRole('button', { name: 'New board' }).click();
      await page.waitForURL(/\/b\//);
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      
      // Deny clipboard permission
      const context = page.context();
      await context.grantPermissions([]); // No permissions
      
      // Open share panel
      await page.getByRole('button', { name: 'Share' }).click();
      await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      
      // Click Copy link - should fail and show manual copy fallback
      await page.getByRole('button', { name: 'Copy link' }).click();
      
      // Manual copy message should be visible
      await expect(page.getByText(/Press Ctrl\+C/)).toBeVisible();
    });
  });
});
