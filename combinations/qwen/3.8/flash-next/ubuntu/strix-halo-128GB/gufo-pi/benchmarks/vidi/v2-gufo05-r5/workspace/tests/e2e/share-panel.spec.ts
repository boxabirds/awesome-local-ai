/**
 * Share panel: manual copy fallback when clipboard is blocked (TC-28).
 *
 * Overrides navigator.clipboard.writeText to reject, then verifies the manual copy
 * message appears and the link field is present.
 */
import { expect, test } from '@playwright/test';
import { navigateToNewBoard } from './helpers/navigate';

test.describe('share panel clipboard fallback', () => {
  test('TC-28: clipboard blocked → manual copy message, link field present', async ({ page }) => {
    await navigateToNewBoard(page);

    // Override clipboard to reject
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('not allowed')) },
        writable: true,
        configurable: true,
      });
    });

    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Copy link' }).click();

    // Manual copy message
    await expect(page.getByText(/Press Ctrl\+C/i)).toBeVisible();
    // Link field still present
    await expect(page.getByRole('textbox', { name: 'Board link' })).toBeVisible();
  });
});
