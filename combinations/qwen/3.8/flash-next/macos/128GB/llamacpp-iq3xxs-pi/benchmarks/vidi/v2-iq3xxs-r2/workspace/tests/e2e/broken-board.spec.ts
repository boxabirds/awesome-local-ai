import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_FAILED_LABEL } from '../../src/client/sync/ConnectionStatus';
import { STICKY_BUTTON_LABEL } from '../../src/client/board/Toolbar';
import { COMPACTION_UPDATE_COUNT, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { boardNotes, setCamera, VIEWPORT_CENTRE } from './helpers/board';
import {
  boardLink,
  closeParticipants,
  createNoteAt,
  createParticipants,
  expectBadgeHidden,
  expectEventually,
  waitForBadge,
  type Participant,
} from './helpers/participants';
import { callTestHook, WranglerProcess } from './helpers/wrangler-process';

/**
 * The broken board, in a real browser against real storage that has been damaged by
 * a real byte-level accident (the test hook writes junk over the snapshot chunk —
 * same-length real junk, not a sentinel). What must be true: the person sees a red
 * message and can type no lies into it, and — after someone repairs the bytes — the
 * same page shows the board again without reloading anything.
 */
const PORT = Number(process.env.AGENT_PORT_E2E_PERSIST ?? 27428);
const INSPECTOR = Number(process.env.AGENT_PORT_E2E_PERSIST_INSPECTOR ?? PORT + 1);
const HOOK_TIMEOUT_MS = 10_000;

// The retry interval plus the client's own backoff cap, with room for the load itself.
const RECOVERY_TIMEOUT_MS = RECONNECT_MAX_BACKOFF_MS + 3 * HOOK_TIMEOUT_MS;

const server = new WranglerProcess(PORT, INSPECTOR, ['TEST_HOOKS:1']);

test.beforeAll(async () => {
  await server.start('broken-board');
});

test.afterAll(async () => {
  await server.stop();
  server.dispose();
});

test('TC-24 a broken board says so, locks itself, and heals without a reload', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const link = boardLink(boardId);

  // A real board: twenty-five notes, then enough small changes to cross the
  // compaction threshold for real — the snapshot that gets damaged is one the
  // server wrote itself.
  const seeded = await callTestHook(server, boardId, 'seed-notes', '?count=25');
  expect(seeded.status).toBe(200);
  const pumped = await callTestHook(
    server,
    boardId,
    'pump-notes',
    `?times=${COMPACTION_UPDATE_COUNT + 25}`,
  );
  expect(pumped.status).toBe(200);

  // The accident.
  const corrupted = await callTestHook(server, boardId, 'corrupt-snapshot');
  expect(corrupted.status).toBe(200);

  // A fresh person opens the board: the truth, in red, and nothing else.
  const [visitor] = await createParticipants(browser, link, 1) as [Participant];
  await waitForBadge(visitor.page, LOAD_FAILED_LABEL, RECOVERY_TIMEOUT_MS);
  expect(await boardNotes(visitor.page)).toHaveLength(0);
  await expect(
    visitor.page.locator(`button[aria-label="${STICKY_BUTTON_LABEL}"]`),
  ).toBeDisabled();

  // Double-clicking makes nothing; the board they are looking at is not their board.
  await visitor.page.mouse.dblclick(640, 400);
  await expect
    .poll(async () => visitor.page.locator('[data-note-id]').count(), { timeout: HOOK_TIMEOUT_MS })
    .toBe(0);
  expect(await boardNotes(visitor.page)).toHaveLength(0);

  // Someone fixes the bytes. The page reloads nothing and waits; the room retries
  // its load on its own interval, the client retries its connection on its own
  // backoff, and the two meet.
  const repaired = await callTestHook(server, boardId, 'repair-snapshot');
  expect(repaired.status).toBe(200);

  await expectEventually(
    visitor.page,
    'the board arrives on the page that was watching it fail',
    async () => (await boardNotes(visitor.page)).length === 25,
    RECOVERY_TIMEOUT_MS,
  );
  await expectBadgeHidden(visitor.page);
  await expect(
    visitor.page.locator(`button[aria-label="${STICKY_BUTTON_LABEL}"]`),
  ).toBeEnabled();

  // Same page, new note — and it stays. The camera moves somewhere the twenty-five
  // recovered notes are not, because a double-click on an old note edits it.
  await setCamera(visitor.page, { x: 5000, y: 5000, zoom: 1 });
  await createNoteAt(visitor, { ...VIEWPORT_CENTRE });
  await expectEventually(
    visitor.page,
    'twenty-six notes after the board healed',
    async () => (await boardNotes(visitor.page)).length === 26,
  );

  // And it really was the same page: no navigation happened anywhere in this test.
  expect(visitor.page.url()).toContain(boardId);
  await closeParticipants([visitor]);
});
