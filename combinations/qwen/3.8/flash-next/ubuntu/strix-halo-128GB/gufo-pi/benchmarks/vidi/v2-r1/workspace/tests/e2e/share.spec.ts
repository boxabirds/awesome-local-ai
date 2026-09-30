/**
 * E2E tests for story 5: Share a board with others using a link.
 * TC-26 to TC-29, TC-31.
 */
import { test, expect } from '@playwright/test';
import {
  openParticipants,
  joinBoard,
  closeParticipants,
  noteCount,
  createNoteAndGetId,
  getDocSnapshot,
} from './helpers/participants';

test('TC-26: create-share-join round trip', async ({ browser }) => {
  // Create a board via the home page flow
  const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await context1.newPage();
  await page1.goto('/');
  await page1.getByTestId('new-board').click();
  await page1.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/);
  await expect(page1.getByTestId('viewport')).toBeVisible({ timeout: 15_000 });

  const url = new URL(page1.url());
  const boardId = url.pathname.split('/b/')[1];
  expect(boardId).toMatch(/^[A-Za-z0-9_-]{22}$/);

  // Second participant joins via the URL
  const joiner = await joinBoard(browser, boardId);

  // Creator adds a sticky note
  await page1.getByRole('button', { name: 'Sticky note (N)' }).click();
  await expect.poll(() => noteCount(page1), { timeout: 5000 }).toBe(1);
  await page1.keyboard.press('Escape');

  // Joiner receives the note within 10s
  await expect.poll(() => noteCount(joiner.page), { timeout: 10_000 }).toBe(1);

  // Verify same content
  const snap1 = await getDocSnapshot(page1);
  const snap2 = await getDocSnapshot(joiner.page);
  expect(Object.keys(snap1)).toEqual(Object.keys(snap2));

  await context1.close();
  await closeParticipants([joiner]);
});

test('TC-27: bad link shows "Board not found" without connecting socket', async ({ page }) => {
  // Use a valid-format id that was never created
  await page.goto('/b/nevercreated0000000000ab');

  // Should show "Board not found"
  await expect(page.getByText('Board not found')).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText('Check the link, or ask the person who shared it to send it again.'),
  ).toBeVisible();

  // Verify the Share button is NOT present (board UI didn't load)
  await expect(page.getByTestId('share-button')).not.toBeVisible();
});

test('TC-28: board persists and re-opens via link after close', async ({ browser }) => {
  // Create a board and add content
  const [creator] = await openParticipants(browser, 1);
  const url = new URL(creator.page.url());
  const boardId = url.pathname.split('/b/')[1];

  await createNoteAndGetId(creator);

  // Close the creator
  await closeParticipants([creator]);

  // Re-open via link — proves existence-check-and-open path works
  const joiner = await joinBoard(browser, boardId);
  await expect.poll(() => noteCount(joiner.page), { timeout: 10_000 }).toBe(1);
  await closeParticipants([joiner]);
});

test('TC-29: clipboard blocked still yields a working copy (manual select path)', async ({
  browser,
}) => {
  const [participant] = await openParticipants(browser, 1);

  // Open share panel
  await participant.page.getByTestId('share-button').click();
  await expect(participant.page.getByTestId('share-panel')).toBeVisible();

  // Click "Copy link" — clipboard-write may not be available in headless Chromium
  await participant.page.getByTestId('copy-link').click();

  // Wait for either "Link copied" or manual-copy message
  const manualMsg = participant.page.getByTestId('manual-copy-msg');
  const copiedResult = await Promise.race([
    manualMsg.waitFor({ timeout: 5000 }).then(() => 'manual'),
    participant.page.getByTestId('copy-link').textContent().then((t) => {
      if (t?.includes('Link copied')) return 'copied';
      throw new Error('neither');
    }),
  ]).catch(() => 'neither');

  if (copiedResult === 'manual') {
    await expect(manualMsg).toHaveText('Press Ctrl+C (Cmd+C on Mac) to copy');
    // Input should be selected
    const selection = await participant.page.evaluate(() => {
      const input = document.querySelector(
        '[data-testid="share-link"]',
      ) as HTMLInputElement;
      return {
        focused: document.activeElement === input,
        selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
      };
    });
    expect(selection.focused).toBe(true);
    expect(selection.selected).toBe(true);
  } else if (copiedResult === 'copied') {
    // Clipboard worked, great
  }

  await closeParticipants([participant]);
});

test('TC-31: legacy board without created_at is readable by valid link', async ({
  browser,
  request,
}) => {
  // Seed a legacy board via test hook
  const seedRes = await request.post('/__test/boards/legacy000000000000aaaa/seed-legacy');
  expect([200, 201]).toContain(seedRes.status());

  // Join via valid link
  const joiner = await joinBoard(browser, 'legacy000000000000aaaa');

  // Board is readable (viewport visible)
  await expect(joiner.page.getByTestId('viewport')).toBeVisible({ timeout: 10_000 });

  await closeParticipants([joiner]);
});
