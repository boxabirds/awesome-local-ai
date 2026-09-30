// Broken board (story 4, TC-24): honest failure, edit lock, recovery without reload.
// Uses the shared e2e server, which runs with TEST_HOOKS=1.
import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { viewport } from './helpers/board';
import { notes } from './helpers/notes';
import { badge } from './helpers/participants';
import { connectNode, seedBoard, testHook } from './helpers/seed';
import { createBoardId } from './helpers/server';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
/** Repair → the room's next allowed retry → the provider's next attempt → sync. */
const RECOVERY_TIMEOUT_MS = LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS + E2E_EVENTUAL_TIMEOUT_MS;

test('TC-24: a board that cannot be loaded says so, cannot be edited, and recovers without a reload', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(RECOVERY_TIMEOUT_MS + 60_000);
  const boardId = await createBoardId(baseURL!);
  await seedBoard(baseURL!, boardId, retroBoard());
  expect(await testHook(baseURL!, boardId, 'compact')).toEqual({ compacted: true });
  expect(await testHook(baseURL!, boardId, 'corrupt-snapshot')).toEqual({ state: 'load-failed' });

  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => window.__vidi6 !== undefined);
  await expect(badge(page)).toHaveText(LOAD_FAILED_TEXT, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(badge(page)).toHaveClass(/is-load_failed/);
  await expect(badge(page)).toHaveCSS('color', 'rgb(160, 28, 28)');
  expect(await page.evaluate(() => window.__vidi6!.connectionState)).toBe('load_failed');
  const reloadMarker = await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = Math.random()));

  // Not an empty editable board: double-click and the Sticky note button create nothing.
  const box = (await viewport(page).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const sticky = page.getByRole('button', { name: 'Sticky note (N)' });
  await expect(sticky).toBeDisabled();
  await sticky.click({ force: true });
  await expect(notes(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__vidi6!.doc.getMap('objects').size)).toBe(0);
  // Retries keep the message up.
  await page.waitForTimeout(1500);
  await expect(badge(page)).toHaveText(LOAD_FAILED_TEXT);

  expect(await testHook(baseURL!, boardId, 'repair')).toEqual({ repaired: true });
  const repairedAt = Date.now();
  await expect(notes(page)).toHaveCount(25, { timeout: RECOVERY_TIMEOUT_MS });
  console.log(`[persistence] TC-24: board appeared ${Date.now() - repairedAt} ms after repair`);
  await expect(badge(page)).toHaveCount(0);
  await expect(sticky).toBeEnabled();
  // Same page (no reload).
  expect(await page.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(reloadMarker);

  // Editing works again and reaches the room.
  await sticky.click();
  await expect(notes(page)).toHaveCount(26);
  await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const reader = await connectNode(baseURL!, boardId);
    const n = reader.doc.getMap('objects').size;
    reader.close();
    return n;
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(26);
  expect(consoleErrors).toEqual([]);
});
