import { expect, test, type Page } from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import {
  appendToNote,
  colourNote,
  createNoteAt,
  dragNoteBy,
  noteIds,
  notePositions,
  noteStates,
  watchErrors,
} from './helpers/live';
import { seedBoardViaSocket, waitForBoardSize } from './helpers/seed-board';
import { startWrangler, type WranglerProcess } from './helpers/wrangler-process';

/**
 * Story 4 — "Return to a board and find everything as it was left", end to end.
 *
 * These tests are the ones the rest of the suite avoids on purpose: they need a
 * server that stops and starts again, because "it was still there when I came
 * back" is only proven across a real process restart, not across a `reload()`
 * that leaves the Durable Object's memory intact (TC-19's PRD note). Each test
 * therefore drives its own `wrangler dev`, whose `--persist-to` directory is the
 * only thing that survives.
 *
 * A page showing a note is not proof the server has it, so before pulling the
 * plug each test checks with an independent client (`waitForBoardSize`) — the
 * room stores before it broadcasts, so a second client seeing a change means it
 * is on disk.
 */

const NOTE_COUNT_POLL = { timeout: 30_000, intervals: [50] };

let server: WranglerProcess;

test.beforeAll(async () => {
  server = await startWrangler({ vars: { TEST_HOOKS: '1' } });
});

test.afterAll(async () => {
  await server.stop();
});

test.describe.configure({ timeout: 300_000 });

/** Open a board and wait until the client is connected and in sync. */
async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`${server.url}/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toBeHidden();
}

test('TC-19: a board that was closed is exactly as it was left when it is reopened', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const page = await browser.newPage();
  await openBoard(page, boardId);

  const first = await createNoteAt(page, notePositions(1)[0]!);
  await appendToNote(page, first, 'groceries');
  await colourNote(page, first, 'green');
  const second = await createNoteAt(page, notePositions(2)[1]!);
  await dragNoteBy(page, second, { x: 120, y: -60 });
  await dragNoteBy(page, second, { x: -40, y: 30 });

  const left = await noteStates(page);
  expect(Object.keys(left).sort()).toEqual([first, second].sort());

  // The server holds it, then the process goes away entirely — not a reload.
  await waitForBoardSize(server.url, boardId, 2);
  await page.close();
  await server.restart();

  // Watching starts with the page that returns to the board: the first client
  // witnessed the outage, so its reconnect noise is expected (story 3's territory).
  const reopened = await browser.newPage();
  const errors = watchErrors(reopened);
  await openBoard(reopened, boardId);
  await expect
    .poll(async () => (await noteIds(reopened)).length, NOTE_COUNT_POLL)
    .toBe(2);

  const returned = await noteStates(reopened);
  expect(Object.keys(returned).sort()).toEqual([first, second].sort());
  for (const id of [first, second]) {
    expect(returned[id]).toEqual(left[id]!);
  }
  await reopened.close();
  expect(errors.errors()).toEqual([]);
});

test('TC-20: killing the server mid-writing loses nothing the user had been told about', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const page = await browser.newPage();
  await openBoard(page, boardId);

  const created: string[] = [];
  const positions = notePositions(3);
  for (const position of positions) {
    created.push(await createNoteAt(page, position));
  }
  const expected = await noteStates(page);
  expect(Object.keys(expected)).toHaveLength(3);

  // Stop the process now: three notes were on screen, nothing else existed.
  await page.close();
  await server.restart();

  const back = await browser.newPage();
  await openBoard(back, boardId);
  await expect
    .poll(async () => (await noteIds(back)).length, NOTE_COUNT_POLL)
    .toBe(3);

  const afterRestart = await noteStates(back);
  // No duplicates: every id appears exactly once, and the set is unchanged.
  expect(Object.keys(afterRestart).sort()).toEqual(created.slice().sort());
  for (const id of created) {
    expect(afterRestart[id]).toEqual(expected[id]);
  }

  // And writing keeps working after the restart, without duplicating.
  created.push(await createNoteAt(back, { x: 1100, y: 620 }));
  await expect
    .poll(async () => (await noteIds(back)).length, NOTE_COUNT_POLL)
    .toBe(4);
  await page.close();
  await back.close();
  await server.restart();

  const again = await browser.newPage();
  await openBoard(again, boardId);
  await expect
    .poll(async () => (await noteIds(again)).length, NOTE_COUNT_POLL)
    .toBe(4);
  const final = await noteStates(again);
  expect(Object.keys(final).sort()).toEqual(created.slice().sort());
  await again.close();
});

test('TC-21: a board of two thousand notes opens within the stated budget after a restart', async ({
  browser,
}) => {
  const boardId = newBoardId();

  // Seeded by a real client over a real socket, so it is the room's own write
  // path (and its own compaction) that produced what the browser must load.
  await seedBoardViaSocket(server.url, boardId, PERSIST_TESTED_NOTES);
  await waitForBoardSize(server.url, boardId, PERSIST_TESTED_NOTES);

  // Memory gone: the open below reads from SQLite like any other cold board.
  await server.restart();

  const page = await browser.newPage();
  const started = Date.now();
  await page.goto(`${server.url}/b/${boardId}`);
  await expect
    .poll(async () => (await noteIds(page)).length, { timeout: 120_000, intervals: [50] })
    .toBe(PERSIST_TESTED_NOTES);
  const elapsed = Date.now() - started;
  console.log(`TC-21: ${PERSIST_TESTED_NOTES} notes opened in ${elapsed}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`);
  // What the user experiences: URL to a board they can see.
  expect(elapsed, `opening ${PERSIST_TESTED_NOTES} notes took ${elapsed}ms`).toBeLessThanOrEqual(
    BOARD_LOAD_BUDGET_MS,
  );
  await page.close();
});
