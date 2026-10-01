import { expect, test } from '@playwright/test';
import { createBoardId } from './helpers/create';
import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { setCamera } from './helpers/board';
import { notesOf } from './helpers/participants';
import { seedBoard } from './helpers/seed';

// The shared web server runs with TEST_HOOKS=1 (see playwright.config.ts).
test('TC-24: broken board - honest failure, no editing, recovery without reload', async ({ page, baseURL, request }) => {
  const board = await createBoardId(baseURL!);
  await seedBoard(baseURL!, board, retroBoard().updates, 25);
  const corrupt = await request.post(`/__test/boards/${board}/corrupt-snapshot`);
  expect(corrupt.status()).toBe(200);

  await page.goto(`/b/${board}`);
  const badge = page.getByTestId('connection-status');
  await expect(badge).toHaveText('This board couldn\'t be loaded. Retrying…', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(badge).toHaveCSS('background-color', 'rgb(211, 47, 47)');
  await expect(notesOf(page)).toHaveCount(0);
  await setCamera(page, 0, 0, 1);
  await page.mouse.dblclick(400, 300);
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
  await expect(notesOf(page)).toHaveCount(0);

  const repair = await request.post(`/__test/boards/${board}/repair`);
  expect(repair.status()).toBe(200);
  await expect(notesOf(page)).toHaveCount(25, { timeout: LOAD_RETRY_MIN_INTERVAL_MS + E2E_EVENTUAL_TIMEOUT_MS * 2 });
  await expect(badge).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
  await page.mouse.dblclick(1000, 600);
  await expect(notesOf(page)).toHaveCount(26);
});
