// Story 4 — a board that cannot be loaded says so, cannot be edited, and recovers
// without a reload (TC-24). Uses the e2e-only storage hooks (TEST_HOOKS=1).
import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { connectionBadge } from './helpers/board';
import { getNotes } from './helpers/participants';
import { createBoard, seedBoard, storageHook } from './helpers/seed';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
/** Recovery needs the room's retry interval plus at most one full client backoff. */
const RECOVERY_TIMEOUT_MS = E2E_EVENTUAL_TIMEOUT_MS + LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS;

test('TC-24 broken board: honest failure message, no editing, recovery without reload', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const base = baseURL!;
  const boardId = await createBoard(base);
  await seedBoard(base, boardId, retroBoard().doc);
  await storageHook(base, boardId, 'compact');
  await storageHook(base, boardId, 'corrupt-snapshot');

  await page.goto(`/b/${boardId}`);
  // Marks this page load; a reload would clear it.
  await page.evaluate(() => ((window as unknown as { __loadMarker: number }).__loadMarker = 42));

  const badge = connectionBadge(page);
  await expect(badge).toHaveText(LOAD_FAILED_TEXT, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(badge).toHaveAttribute('role', 'status');
  expect(await badge.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(161, 22, 10)');

  // Not editable: double-click on the board and the Sticky note button create nothing.
  await page.mouse.dblclick(640, 400);
  const stickyButton = page.getByRole('button', { name: 'Sticky note' });
  await expect(stickyButton).toBeDisabled();
  await stickyButton.click({ force: true });
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await getNotes(page)).toHaveLength(0);
  await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(0);
  // Still failing after more retries: the message stays.
  await page.waitForTimeout(1500);
  await expect(badge).toHaveText(LOAD_FAILED_TEXT);

  await storageHook(base, boardId, 'repair');
  const repairedAt = Date.now();
  await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(25, { timeout: RECOVERY_TIMEOUT_MS });
  console.log(`[persist] TC-24: board appeared ${Date.now() - repairedAt} ms after repair`);
  await expect(badge).toHaveCount(0);
  await expect(stickyButton).toBeEnabled();
  await stickyButton.click();
  await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(26);
  // Same page load throughout.
  expect(await page.evaluate(() => (window as unknown as { __loadMarker?: number }).__loadMarker)).toBe(42);
});
