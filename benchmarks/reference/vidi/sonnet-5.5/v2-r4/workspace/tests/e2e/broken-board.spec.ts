import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { retroBoard25 } from '../fixtures/boards';
import { seedBoard } from './helpers/seed';

const MESSAGE = "This board couldn't be loaded. Retrying…";

test('TC-24 broken board: honest failure, no editing, recovery without a reload', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const boardId = newBoardId();
  await seedBoard(baseURL!, boardId, retroBoard25().doc);
  const hook = (name: string) => request.post(`/__test/boards/${boardId}/${name}`);
  expect((await hook('corrupt-snapshot')).ok()).toBe(true);

  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor();
  await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText(MESSAGE)).toHaveCSS('background-color', 'rgb(211, 47, 47)');
  const notes = page.getByRole('group', { name: 'Sticky note' });
  await expect(notes).toHaveCount(0);

  // Not an editable empty board.
  await expect(page.getByRole('button', { name: 'Sticky note (N)' })).toBeDisabled();
  await page.mouse.dblclick(600, 400);
  await page.keyboard.type('should not appear');
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);

  // Repair; the page keeps retrying and picks the board up by itself.
  expect((await hook('repair')).ok()).toBe(true);
  await expect(notes).toHaveCount(25, { timeout: LOAD_RETRY_MIN_INTERVAL_MS + 25_000 });
  await expect(page.getByText(MESSAGE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sticky note (N)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sticky note (N)' }).click();
  await expect(notes).toHaveCount(26);
});
