/**
 * Story 4 workflow "Broken board" (persist.client_status, TC-24): a saved board whose
 * snapshot is damaged shows the red message and cannot be edited; once storage is
 * repaired the retrying page loads the board by itself, without a reload.
 * Uses the TEST_HOOKS-only storage routes of the shared e2e server.
 */
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { RETRO_NOTES, buildRetroBoard } from '../fixtures/boards';
import { closeAll, notes, openParticipant, type Participant } from './helpers/participants';
import { compactBoard, corruptSnapshot, repairSnapshot, seedBoard } from './helpers/seed';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
const FIRST_MESSAGE_TIMEOUT_MS = 15_000;
/** Recovery needs the room's retry interval plus at most one full provider backoff. */
const RECOVERY_TIMEOUT_MS = LOAD_RETRY_MIN_INTERVAL_MS + 2 * RECONNECT_MAX_BACKOFF_MS;

let people: Participant[] = [];
test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test('TC-24 broken board: honest message, no editing, recovery without reload', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const origin = baseURL!;
  const boardId = newBoardId();
  const doc = new Y.Doc();
  buildRetroBoard(doc);
  await seedBoard(origin, boardId, doc);
  expect(await compactBoard(origin, boardId)).toBe(true);
  expect(await corruptSnapshot(origin, boardId)).toBe('load-failed');

  // Open in a fresh context; openParticipant waits for "connected", so open the page directly.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  people.push({ name: 'Priya', context, page, errors: [], dialogs: [], setOnline: async () => {} });
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });
  await page.goto(`/b/${boardId}`);

  const badge = page.getByTestId('connection-status');
  await expect(badge).toHaveText(LOAD_FAILED_TEXT, { timeout: FIRST_MESSAGE_TIMEOUT_MS });
  await expect(badge).toHaveAttribute('role', 'status');
  expect(await badge.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(164, 14, 38)');
  await expect(notes(page)).toHaveCount(0);

  // Not editable: double-click and the Sticky note button create nothing.
  await page.mouse.dblclick(640, 400);
  const button = page.getByRole('button', { name: 'Sticky note' });
  await expect(button).toBeDisabled();
  await button.click({ force: true });
  await page.waitForTimeout(300);
  await expect(notes(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
  await expect(badge).toHaveText(LOAD_FAILED_TEXT);

  // Repair: the page keeps retrying and loads the board on its own.
  await repairSnapshot(origin, boardId);
  await expect(notes(page)).toHaveCount(RETRO_NOTES, { timeout: RECOVERY_TIMEOUT_MS });
  await expect(badge).toHaveCount(0);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(notes(page)).toHaveCount(RETRO_NOTES + 1);
  expect(navigations).toBe(1);

  // The recovered board is live and saved: a second person sees the new note.
  const sam = await openParticipant(browser, boardId, 'Sam');
  people.push(sam);
  await expect(notes(sam.page)).toHaveCount(RETRO_NOTES + 1);
});
