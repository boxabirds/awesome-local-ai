/**
 * Create → Share → Copy → new tab → same board (TC-26).
 *
 * From a fresh home page, creates a board via the "New board" button, opens the Share panel,
 * copies the link, opens it in a new tab, and verifies the same board loads.
 */
import { expect, test } from '@playwright/test';
import { createBoardViaHome } from './helpers/navigate';

test.describe('create and share', () => {
  test('TC-26: New board → Share → Copy link → open in new tab → same board', async ({
    browser,
    context,
  }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Person opens home and clicks "New board"
    const page = await context.newPage();
    const boardId = await createBoardViaHome(page);

    // The URL is /b/<id>
    expect(page.url()).toContain(`/b/${boardId}`);

    // Opens the Share panel and copies the link
    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await expect(dialog).toBeVisible();

    // Link field has the correct URL
    const linkValue = await dialog.getByRole('textbox', { name: 'Board link' }).inputValue();
    expect(linkValue).toBe(`${new URL(page.url()).origin}/b/${boardId}`);

    // Copy link
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('✓ Link copied')).toBeVisible();

    // Open the link in a new tab (new context to verify no shared state)
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto(linkValue);

    // The new tab shows the same board (board viewport is visible)
    await expect(otherPage.getByTestId('board-viewport')).toBeVisible();
    // And NOT the "not found" page
    await expect(otherPage.getByRole('heading', { name: 'Board not found' })).not.toBeVisible();

    await page.close();
    await otherPage.close();
    await otherContext.close();
  });
});
