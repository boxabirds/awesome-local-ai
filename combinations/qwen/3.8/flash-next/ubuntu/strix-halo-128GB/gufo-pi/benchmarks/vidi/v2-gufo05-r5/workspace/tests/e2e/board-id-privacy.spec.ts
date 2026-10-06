/**
 * Board id privacy: the id never appears in a network request header (TC-29, @nightly).
 *
 * Opens a board, creates a note, and checks that all network request headers do not contain
 * the board id.
 */
import { expect, test } from '@playwright/test';
import { navigateToNewBoard } from './helpers/navigate';

test.describe('board id privacy', () => {
  test('TC-29: no network request header contains the board id @nightly', async ({ page }) => {
    const boardId = await navigateToNewBoard(page);

    // Collect all request headers from the page's network activity
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    page.on('request', (request) => {
      requests.push({ url: request.url(), headers: request.headers() });
    });

    // Create a note (triggers sync frames)
    await page.getByTestId('create-sticky-button').click();
    await page.waitForTimeout(500);

    // Reload the page (triggers more requests)
    await page.reload();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await page.waitForTimeout(500);

    // Check all collected request headers for the board id
    // The only exception: the URL path itself contains the id (that's not a header)
    for (const req of requests) {
      for (const [name, value] of Object.entries(req.headers)) {
        expect(
          value.includes(boardId),
          `header "${name}" on ${req.url} contains the board id`,
        ).toBe(false);
      }
    }
  });
});
