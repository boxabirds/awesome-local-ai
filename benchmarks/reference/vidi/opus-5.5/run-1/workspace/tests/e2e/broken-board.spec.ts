/**
 * persist.client_status in a real browser: a board whose saved snapshot is damaged shows the
 * red message and cannot be edited; once storage is repaired it appears without a reload.
 * Uses the test-only storage routes of the shared server (started with TEST_HOOKS=1).
 */
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { RETRO_NOTES, boardState, retroLog } from '../fixtures/boards';
import { getNotes, noteLocator } from './helpers/board';
import { boardUrl, connectionBadge, connectionState } from './helpers/participants';
import { compactBoard, corruptSnapshot, repairSnapshot, seedBoard } from './helpers/seed';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
/** After repair: the room retries after LOAD_RETRY_MIN_INTERVAL_MS; the client within its max backoff. */
const RECOVERY_TIMEOUT_MS = LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS * 2;
const TEST_TIMEOUT_MS = 120_000;
/** Screen point left of the retro board's notes (they occupy world x ≥ -100 around the centre). */
const EMPTY_SPOT = { x: 250, y: 200 } as const;
const BADGE_RED = 'rgb(183, 28, 28)';

test('Workflow "Broken board" TC-24: honest failure, no editing, recovery without reload', async ({ page, baseURL }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const base = baseURL!;
  const boardId = newBoardId();
  const log = retroLog();
  const saved = new Y.Doc();
  Y.applyUpdate(saved, Y.encodeStateAsUpdate(log.doc));
  await seedBoard(base, boardId, saved);
  expect(await compactBoard(base, boardId)).toBe(true);
  expect(await corruptSnapshot(base, boardId)).toBe('load-failed');

  await page.goto(boardUrl(boardId));
  const badge = connectionBadge(page);
  await expect(badge).toHaveText(LOAD_FAILED_TEXT);
  await expect(badge).toHaveAttribute('data-state', 'load_failed');
  await expect(badge).toHaveCSS('color', BADGE_RED);
  expect(await connectionState(page)).toBe('load_failed');
  await page.evaluate(() => {
    (window as unknown as { __notReloaded: boolean }).__notReloaded = true;
  });

  // Not editable: double-click creates nothing; the Sticky note button is disabled.
  await page.mouse.dblclick(EMPTY_SPOT.x, EMPTY_SPOT.y);
  const stickyButton = page.getByRole('button', { name: 'Sticky note' });
  await expect(stickyButton).toBeDisabled();
  await stickyButton.click({ force: true });
  await expect(noteLocator(page)).toHaveCount(0);
  expect(await getNotes(page)).toHaveLength(0);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);

  await repairSnapshot(base, boardId);

  // The board appears on its own: same page, badge gone, all notes, editing back.
  await expect(noteLocator(page)).toHaveCount(RETRO_NOTES, { timeout: RECOVERY_TIMEOUT_MS });
  await expect(badge).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);
  expect((await getNotes(page)).map(({ id, text, color, x, y, z }) => ({ id, text, color, x, y, z }))).toEqual(
    boardState(log.doc),
  );
  await expect(stickyButton).toBeEnabled();
  await page.mouse.dblclick(EMPTY_SPOT.x, EMPTY_SPOT.y);
  await expect(noteLocator(page)).toHaveCount(RETRO_NOTES + 1);
});

test('the test-only storage routes do not exist without TEST_HOOKS (production build)', async () => {
  // The integration suite runs the Worker without TEST_HOOKS; see board-room-persistence.test.ts.
  // Here: the production wrangler config never sets it.
  const { readFileSync } = await import('node:fs');
  const config = readFileSync('wrangler.jsonc', 'utf8');
  expect(config).not.toMatch(/"TEST_HOOKS"\s*:/);
});
