// Story 4 end to end: a user leaves the board and comes back to the same board,
// and the whole stack - browser, Worker, Durable Object, SQLite on disk - has to
// still be holding what they left behind.
//
// TC-19 asks the room to forget its in-memory document (what a wake-up does) and
// then reloads the page, so the notes can only come from SQLite.
// TC-20 stops the `wrangler dev` process that owns the Durable Object and starts
// another one against the same persistence directory: the process holding the
// board in memory is really gone.
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { openBoard, connectionBadge } from './helpers/room.ts';
import { createNoteAt, typeText, notes } from './helpers/sticky.ts';
import {
  forgetRoom,
  notesRestored,
  readNotes,
  roomStats,
  waitForRoom,
} from './helpers/persistence.ts';
import { startWorker, type ManagedWorker } from './helpers/wrangler-process.ts';

// The dev server this file owns, so its persistence directory can be restarted.
const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 4199);

async function leaveNote(page: import('@playwright/test').Page, at: { x: number; y: number }, text: string) {
  await createNoteAt(page, at.x, at.y);
  await typeText(page, text);
  await page.keyboard.press('Escape');
}

test('TC-19 returning to a board finds everything as it was left', async ({ page }) => {
  test.setTimeout(90_000);
  const boardId = newBoardId();
  await openBoard(page, boardId);

  await leaveNote(page, { x: 420, y: 300 }, 'Still here');
  await leaveNote(page, { x: 760, y: 430 }, 'and me');

  // Durable before the room is allowed to forget: the rows are in the log.
  const written = await waitForRoom(boardId, (s) => s.logRows >= 2, 'two rows in the update log');
  expect(written.state).toBe('ready');

  const left = await readNotes(page);
  expect(left.length).toBe(2);
  expect(left.map((n) => n.text).sort()).toEqual(['Still here', 'and me']);

  // The room throws its memory away and reads the board back from storage,
  // which is exactly what an instance woken after being evicted does.
  const woken = await forgetRoom(boardId);
  expect(woken.state).toBe('ready');
  expect(woken.serving).toBe(true);
  // One row per keystroke, not per note: typing is a stream of small updates.
  expect(woken.logRows).toBeGreaterThanOrEqual(2);

  // The user comes back. Nothing here can be served from the room's memory, and
  // the page has no memory either.
  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  expect(await notesRestored(page, left)).toBe('');

  // The board is editable again, not a picture of the old board.
  expect((await readNotes(page)).every((n) => n.editable)).toBe(true);
  await leaveNote(page, { x: 200, y: 620 }, 'added later');
  expect(await notes(page).count()).toBe(3);
  // The badge renders nothing in the steady state, so its absence is the
  // "connected" assertion.
  await expect(connectionBadge(page)).toHaveCount(0);
});

test.describe('a worker that is stopped and started again', () => {
  let worker: ManagedWorker;

  test.beforeEach(async () => {
    worker = await startWorker(WORKER_PORT);
  });

  test.afterEach(async () => {
    await worker?.dispose();
  });

  test('TC-20 the board comes back from SQLite on disk', async ({ browser }) => {
    // Two cold starts of a real `wrangler dev` are part of this test.
    test.setTimeout(600_000);
    const boardId = newBoardId();
    const page = await browser.newPage();
    await page.goto(`${worker.origin}/b/${boardId}`);
    await page.waitForSelector('[data-testid="viewport"]');

    await leaveNote(page, { x: 420, y: 300 }, 'Survives the process');
    await leaveNote(page, { x: 760, y: 430 }, 'and the restart');

    const left = await readNotes(page);
    expect(left.length).toBe(2);
    // Written where a restart cannot reach it: on disk.
    await waitForRoom(boardId, (s) => s.logRows >= 2, 'two rows on disk', worker.origin);

    // The process that holds this board in memory goes away entirely.
    await worker.stop();
    await worker.restart();

    // Coming back to the board: the room has never seen this board in its life,
    // and it serves the stored one.
    await page.goto(`${worker.origin}/b/${boardId}`);
    await page.waitForSelector('[data-testid="viewport"]');
    expect(await notesRestored(page, left)).toBe('');

    const stats = await roomStats(boardId, worker.origin);
    expect(stats.state).toBe('ready');
    expect(stats.serving).toBe(true);
    expect(stats.logRows).toBeGreaterThanOrEqual(2);

    // A second restart still has it - persistence is not a one-shot.
    await worker.restart();
    await page.goto(`${worker.origin}/b/${boardId}`);
    await page.waitForSelector('[data-testid="viewport"]');
    expect(await notesRestored(page, left)).toBe('');

    await page.close();
  });
});
