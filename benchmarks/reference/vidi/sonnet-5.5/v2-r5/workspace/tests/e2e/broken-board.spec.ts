import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { build25NoteBoard } from '../fixtures/boards';
import { settled } from './helpers/board';
import { notesOf } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const MESSAGE = "This board couldn't be loaded. Retrying…";

test('TC-24 Broken board: honest failure, editing blocked, recovery without reload', async ({ browser, request, baseURL }) => {
  const boardId = newBoardId();
  await seedBoard(baseURL!, boardId, (doc) => { build25NoteBoard(doc); });

  const corrupt = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
  expect(await corrupt.text()).toBe('corrupted');

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await settled(page);

  const message = page.getByRole('status').filter({ hasText: MESSAGE });
  await expect(message).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(notesOf(page)).toHaveCount(0);
  const color = await message.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).toBe('rgb(198, 40, 40)'); // red

  // Not editable: neither double-click nor the Sticky note button creates anything.
  await page.mouse.dblclick(400, 300);
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
  await page.keyboard.type('nope');
  await expect(notesOf(page)).toHaveCount(0);

  // Repair, then wait for the automatic retry (no reload).
  expect(await (await request.post(`/__test/boards/${boardId}/repair`)).text()).toBe('repaired');
  await page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 500);
  await expect(notesOf(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
  await expect(message).toHaveCount(0);

  await page.mouse.dblclick(100, 150);
  await expect(notesOf(page)).toHaveCount(26);
  await context.close();
});
