/**
 * persist.room where the claim is actually made: a browser, a Worker process that
 * can be killed, and a disk underneath.
 *
 * The integration suite can say "the room read the board on the way up"; only here
 * can a board be built by a real person, the process running the room be stopped
 * dead, and the same board be opened again afterwards. Each case owns a `wrangler
 * dev` process (`helpers/wrangler-process.ts`) whose Durable Object storage is a
 * temporary directory of its own, so nothing carries between cases and nothing is
 * left behind.
 *
 * TC-19  the board a person left is the board they come back to
 * TC-20  a change somebody else has already seen is on the disk before they leave
 * TC-21  a large saved board opens completely (the time is reported, not asserted:
 *        model, browsers and server share this one machine)
 */

import { expect, test, type Page } from '@playwright/test';

import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { createBoardAt } from '../fixtures/board-api';
import { boardHooks } from '../fixtures/hooks';
import {
  boardJson,
  closeAll,
  createNoteAt,
  expectNoErrors,
  openBoardAs,
  recolourNote,
} from './helpers/live';
import { getNotes, typeIntoEditor } from './helpers/notes';
import {
  BoardServer,
  PERSIST_E2E_PORT,
  createPersistDirectory,
  removePersistDirectory,
} from './helpers/wrangler-process';

/** The server these cases talk to, so relative navigations land on it. */
test.use({ baseURL: `http://127.0.0.1:${PERSIST_E2E_PORT}` });

// One server per case, on one port: they cannot share it, because the point of each
// case is that the process is stopped and started again.
test.describe.configure({ mode: 'serial' });

const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

const PHRASES = [
  'Ship the release notes before the demo',
  'The import path is unclear — link the setup doc',
  'Loved the pairing rotation this week',
  'Too many meetings on Thursday afternoons',
  'Ask design for the empty-state illustrations',
  'Autocomplete should search titles only, not body text',
  'Investigate the flaky upload test on CI',
  'Someone write down how the board id gets shared',
];

let persistTo = '';
let server: BoardServer | undefined;

async function startServer(): Promise<BoardServer> {
  const started = new BoardServer({ persistTo, testHooks: true });
  await started.start();
  server = started;
  return started;
}

/**
 * Build a board the way a person does: double-click, type, move on. Varied in text,
 * colour and position, so that "identical afterwards" means identical in everything
 * a note is made of rather than identical in one field.
 */
async function buildVariedBoard(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const at = { x: 220 + (index % 5) * 240, y: 150 + Math.floor(index / 5) * 140 };
    const id = await createNoteAt(page, at);
    await typeIntoEditor(page, `${PHRASES[index % PHRASES.length]} (${index + 1})`);
    await page.keyboard.press('Escape');
    if (index % 3 === 1) await recolourNote(page, id, COLOURS[(index >> 1) % COLOURS.length] ?? 'yellow');
  }
  await expect
    .poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
}

/** The parts of a note that a person would notice missing. */
function compareFields(notes: readonly StickySnapshot[]): string {
  return JSON.stringify(
    notes.map((note) => ({
      text: note.text,
      color: note.color,
      x: note.x,
      y: note.y,
      z: note.z,
    })),
  );
}

test.beforeAll(async () => {
  persistTo = await createPersistDirectory('e2e-persistence');
});

test.afterAll(async () => {
  await server?.stop();
  if (persistTo) await removePersistDirectory(persistTo);
});

test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

test('TC-19: the board a person left is the board they come back to', async ({ browser }) => {
  const board = await startServer();
  // Story 5: this board has to be created before anyone can open it.
  const boardId = await createBoardAt(board.origin);

  const people = await openBoardAs(browser, boardId, ['Alex']);
  const alex = people[0]!;
  await buildVariedBoard(alex.page, 25);
  // Everything said here has reached the board before the person leaves.
  await boardHooks(board.origin).status(boardId);
  const leftBehind = compareFields(await getNotes(alex.page));
  const wholeBoard = await boardJson(alex.page);
  await closeAll(people);

  // Not a reload: the process that held the board is stopped where it stands, and
  // another one is started in its place over the same data.
  await board.restart();

  const [back] = await openBoardAs(browser, boardId, ['Alex']);
  await expect
    .poll(async () => (await getNotes(back.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(25);
  expect(compareFields(await getNotes(back.page))).toBe(leftBehind);
  // Including the ids, so it is the same board and not one rebuilt to look like it.
  expect(await boardJson(back.page)).toBe(wholeBoard);
  expectNoErrors([back]);
});

test('TC-20: what somebody has already seen was on the disk before they left', async ({
  browser,
}) => {
  const board = await startServer();
  // Story 5: this board has to be created before anyone can open it.
  const boardId = await createBoardAt(board.origin);

  const people = await openBoardAs(browser, boardId, ['Alex', 'Sam']);
  const alex = people[0]!;
  const sam = people[1]!;

  const text = 'written once, seen by both, kept';
  const id = await createNoteAt(alex.page, { x: 640, y: 400 });
  await typeIntoEditor(alex.page, text);
  await alex.page.keyboard.press('Escape');

  // Sam sees it. The room stores a change before it lets anyone see it, so at this
  // moment the note is already written — and this is the last moment worth keeping.
  await expect
    .poll(async () => (await getNotes(sam.page)).some((note) => note.text.includes(text)), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(true);
  const seen = Date.now();

  // Both leave, and the process goes with them, inside the second the design allows.
  await closeAll(people);
  await board.stop();
  const stopped = Date.now();

  await board.start();
  const [back] = await openBoardAs(browser, boardId, ['Alex']);
  await expect
    .poll(
      async () =>
        (await getNotes(back.page)).some((note) => note.id === id && note.text.includes(text)),
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
  console.log(
    `TC-20: seen by Sam and the process was gone ${stopped - seen} ms later; the note came back`,
  );
  expectNoErrors([back]);
});

test('TC-21: a large saved board opens completely', async ({ page }) => {
  test.setTimeout(300_000);
  const board = await startServer();
  const boardId = newBoardId();
  const hooks = boardHooks(board.origin);

  // The board is filled by the room itself, in one update, and compacted — which is
  // what a board of this size looks like after a night's work: a snapshot in chunks,
  // not a log to replay.
  const seeded = await hooks.seed(boardId, 'large', PERSIST_TESTED_NOTES);
  expect(seeded.notes).toBeGreaterThanOrEqual(PERSIST_TESTED_NOTES);
  expect(seeded.storage.snapshotChunks).toBeGreaterThanOrEqual(1);
  // Then the room that knows it by heart is thrown away, so the person opening it
  // makes another one read it off the disk.
  await hooks.abort(boardId);

  const started = Date.now();
  await page.goto(`/b/${boardId}`);
  await expect
    .poll(
      () => page.evaluate(() => document.querySelectorAll('[data-note-id]').length),
      { timeout: 240_000, message: 'every note should be on screen' },
    )
    .toBe(PERSIST_TESTED_NOTES);
  const elapsed = Date.now() - started;
  console.log(
    `TC-21: ${PERSIST_TESTED_NOTES} notes from storage on screen in ${elapsed} ms ` +
      `(budget ${BOARD_LOAD_BUDGET_MS} ms${elapsed > BOARD_LOAD_BUDGET_MS ? ', over on this shared machine' : ''})`,
  );

  const notes = await getNotes(page);
  expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
  expect(notes.every((note) => note.text.length > 0)).toBe(true);
  expect(new Set(notes.map((note) => note.id)).size).toBe(PERSIST_TESTED_NOTES);
});
