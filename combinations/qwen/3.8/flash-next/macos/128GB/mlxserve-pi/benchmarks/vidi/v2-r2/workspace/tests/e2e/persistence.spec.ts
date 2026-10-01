// Story 4, end to end: a board is still there after the process that served it is
// gone. These tests own their `wrangler dev` process (see
// `helpers/wrangler-process.ts`) because the thing under test is the process
// dying - the board has to come back out of the `--persist-to` directory with
// nothing remembered in memory.
//
//   TC-19 a restarted server serves the same board
//   TC-21 compaction happens during use, and the board survives a restart
//   TC-24 a board whose storage is unreadable says so, in every browser
//   TC-20 a board of 2000 notes loads inside the load budget          (@nightly)
//
// `npm run test:e2e` runs TC-19, TC-21 and TC-24 in chromium, firefox and webkit;
// `npm run test:e2e:nightly` adds TC-20.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { BOARD_LOAD_FAILED_MESSAGE } from '../../src/shared/protocol';
import {
  content,
  connectionState,
  createNoteViaToolbar,
  noteCount,
  waitForContentsMatch,
  waitForSyncReady,
  type Content,
} from './helpers/live';
import { removeStateDir, WranglerProcess } from './helpers/wrangler-process';

/**
 * Create notes through the page's own document, `perTransaction` of them per edit.
 *
 * The number of *edits* is what the room's update log counts. A page merges
 * everything it changed in one turn of the event loop into a single update, so
 * `perTransaction: 1` - one note per edit, which is what a person does - builds a
 * board whose log is as long as the board is big, exactly what a test about
 * compaction wants; a large value builds the same board out of few edits for a test
 * that only cares about how big the board is.
 */
async function createNotes(page: Page, count: number, perTransaction = 1): Promise<void> {
  await page.evaluate(
    ([total, per]) =>
      (
        window as unknown as {
          __vidi6: {
            __createNotes(count: number, withTextEvery?: number, per?: number): Promise<number>;
          };
        }
      ).__vidi6.__createNotes(total, 2, per),
    [count, perTransaction] as [number, number],
  );
}

/** Open a board on *this* server (the shared one on port 4173 is not ours). */
async function openAt(server: WranglerProcess, browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.boardUrl(boardId));
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForSyncReady(page);
  await expect.poll(() => connectionState(page), { timeout: 20_000 }).toBe('connected');
  return page;
}

/** Come back to the board, the way a person returning to it does. */
async function reopen(server: WranglerProcess, page: Page, boardId: string): Promise<void> {
  await page.goto(server.boardUrl(boardId));
  await waitForSyncReady(page);
  await expect.poll(() => connectionState(page), { timeout: 30_000 }).toBe('connected');
}

/**
 * Wait until the room has written the board down, which is what a test about to
 * kill the process has to be sure of.
 *
 * The room stores an update before it repeats it to anybody else - that ordering is
 * story 4's promise, and the integration tests hold it - so a second page that now
 * holds the same content as the first is proof the content reached storage, and not
 * merely the page that typed it. Comparing the typing page with itself would prove
 * nothing: a page always has what it was just typed.
 */
async function storedByRoom(
  server: WranglerProcess,
  browser: Browser,
  page: Page,
  boardId: string,
  timeout = 60_000,
): Promise<void> {
  const peer = await openAt(server, browser, boardId);
  try {
    await waitForContentsMatch([page, peer], timeout);
  } finally {
    await peer.close();
  }
}

// These tests are run one after another, on purpose. Each one owns a real
// `wrangler dev` process (that is the point of them), and a handful of those
// alongside the rest of the suite is enough load to make other people's timing
// assertions wobble. Serial keeps the extra processes to one per browser.
test.describe.configure({ mode: 'serial' });

let server: WranglerProcess;

test.beforeEach(async ({}, testInfo) => {
  server = await WranglerProcess.start({
    // One storage directory per test, so no board can be served from another
    // test's leftovers.
    label: (testInfo.title.match(/TC-\d+/)?.[0] ?? 'e2e').toLowerCase(),
    testHooks: true,
  });
});

test.afterEach(async () => {
  if (server === undefined) return; // the server never started; nothing to clean up
  const stateDir = server.stateDir;
  await server.stop();
  removeStateDir(stateDir);
});

test.describe('returning to a board', () => {
  test('TC-19 a restarted server serves the same board', async ({ browser }) => {
    test.setTimeout(180_000);
    const boardId = await server.createBoard();
    const page = await openAt(server, browser, boardId);

    // Made the way a person makes them, so what has to survive is real content.
    await createNoteViaToolbar(page, 'stay here');
    await createNoteViaToolbar(page, 'and here');
    await createNoteViaToolbar(page, 'and here too');
    const before = await content(page);
    // `content` is ordered by note id, so compare the texts as a set.
    expect([...before.map((note: Content) => note.text)].sort()).toEqual([
      'and here',
      'and here too',
      'stay here',
    ]);

    // Everything has reached the room, so what is measured is the board being read
    // back rather than a keystroke that was still on its way.
    await storedByRoom(server, browser, page, boardId);

    // The process dies. Everything it held in memory is gone; all that is left is
    // the directory it was told to persist to.
    await server.restart();

    await reopen(server, page, boardId);
    await expect.poll(() => noteCount(page)).toBe(3);
    expect(await content(page)).toEqual(before);

    // And the board is live rather than a picture of itself: a note made after the
    // restart is stored like any other, and a second browser finds it there.
    await createNoteViaToolbar(page, 'after the restart');
    await expect.poll(() => noteCount(page)).toBe(4);
    const other = await openAt(server, browser, boardId);
    await expect.poll(() => noteCount(other)).toBe(4);
    expect(await content(other)).toEqual(await content(page));

    await other.close();
    await page.close();
  });

  test('TC-21 compaction happens during use and the board survives a restart', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = await server.createBoard();
    const page = await openAt(server, browser, boardId);

    // More separate edits than the log is allowed to hold, so the room has to fold
    // them into a snapshot while the board is being used.
    // One note per edit, so the log holds as many updates as the board has notes.
    await createNotes(page, 560);
    await expect.poll(() => noteCount(page), { timeout: 120_000 }).toBe(560);

    // Compaction ran with the page still connected: the stored snapshot reaches
    // past the start of the board, and the log holds fewer updates than were made.
    await expect
      .poll(async () => (await server.diagnostics(boardId)).snapshotThrough, {
        timeout: 90_000,
      })
      .toBeGreaterThan(0);
    const compacted = await server.diagnostics(boardId);
    expect(compacted.updates).toBeLessThan(560);
    // Every connection read in this file waits for the state it names, and this one
    // has to as much: a board that has just compacted is a board that has just
    // resynced, and "confirmed" is the state shown for a moment on the way back to
    // "connected". Waiting keeps the assertion, which is that the page ends up
    // connected; assuming it had already got there was the flake.
    await expect
      .poll(() => connectionState(page), { timeout: 30_000 })
      .toBe('connected');
    const before = await content(page);
    expect(before).toHaveLength(560);

    await storedByRoom(server, browser, page, boardId, 120_000);

    // A compacted board comes back whole after the process is gone.
    await server.restart();
    await reopen(server, page, boardId);
    await expect.poll(() => noteCount(page), { timeout: 90_000 }).toBe(560);
    expect(await content(page)).toEqual(before);

    await page.close();
  });
});

test.describe('a board that cannot be loaded', () => {
  test('TC-24 an unreadable board says so, takes no edits, and comes back by itself', async ({
    browser,
  }) => {
    test.setTimeout(360_000);
    const boardId = await server.createBoard();
    const page = await openAt(server, browser, boardId);
    await createNotes(page, 25);
    await expect.poll(() => noteCount(page)).toBe(25);
    const saved = await content(page);

    // Everything is written down - and then damaged there, which is what a bad row
    // in storage looks like.
    await storedByRoom(server, browser, page, boardId);
    expect((await server.hook(boardId, 'corrupt-snapshot')).state).toBe('load-failed');

    // The page that was already open is told, through the socket it had.
    await expect(page.getByTestId('connection-status')).toContainText(BOARD_LOAD_FAILED_MESSAGE);
    await expect.poll(() => connectionState(page)).toBe('load_failed');

    // A board opened from scratch says the same thing. The thing this test is
    // really about: the board is not offered as an empty one, because an empty
    // board is a board that invites you to work on it.
    const fresh = await browser.newContext().then((context) => context.newPage());
    await fresh.goto(server.boardUrl(boardId));
    await waitForSyncReady(fresh);
    await expect(fresh.getByTestId('connection-status')).toContainText(BOARD_LOAD_FAILED_MESSAGE);
    await expect(fresh.getByTestId('board-load-failed')).toBeVisible();
    expect(await noteCount(fresh)).toBe(0);

    // And it takes nothing: no note can be made, so nothing can be edited,
    // recoloured, dragged or thrown away. The alternative - a note that looks
    // perfectly fine and was never written down anywhere - is the failure this
    // prevents.
    await expect(fresh.getByTestId('create-sticky')).toBeDisabled();
    await fresh
      .locator('[data-testid="board-viewport"]')
      .dblclick({ position: { x: 420, y: 320 } });
    await fresh
      .locator('[data-testid="board-viewport"]')
      .dblclick({ position: { x: 520, y: 380 } });
    // A disabled button does not fire; Playwright says so rather than pretending.
    await expect(fresh.getByTestId('create-sticky').click({ timeout: 2_000 })).rejects.toThrow();
    expect(await noteCount(fresh)).toBe(0);

    // Put the row back. The page is never reloaded, and the board arrives on one of
    // the attempts the provider was making anyway.
    expect((await server.hook(boardId, 'repair-snapshot')).state).toBe('ready');
    await expect.poll(() => noteCount(fresh), { timeout: 120_000 }).toBe(25);
    await expect.poll(() => connectionState(fresh), { timeout: 30_000 }).toBe('connected');
    await expect(fresh.getByTestId('board-load-failed')).toHaveCount(0);
    expect(await content(fresh)).toEqual(saved);

    // The page that was open when the board went bad came back too - it was never
    // asked to do anything but keep trying.
    await expect.poll(() => connectionState(page), { timeout: 120_000 }).toBe('connected');

    // And it is a board again: a new note goes in, and reaches the other page.
    await createNoteViaToolbar(fresh, 'after the repair');
    await expect.poll(() => noteCount(fresh)).toBe(26);
    await expect.poll(() => noteCount(page), { timeout: 30_000 }).toBe(26);

    await fresh.close();
    await page.close();
  });

  test('TC-24 a server that was not given the hooks has no hooks', async () => {
    // The hooks can damage a board, so they are not part of a server anybody can
    // start: without the `TEST_HOOKS` variable the routes are not registered at all
    // and the address is simply not a board address, which the server answers the
    // way it answers any address that is not one.
    const plain = await WranglerProcess.start({
      label: 'tc24-no-hooks',
      testHooks: false,
    });
    try {
      const diagnostics = await plain.probe(`/__test/boards/${newBoardId()}/diagnostics`);
      expect(diagnostics.body).not.toContain('snapshotThrough');
      expect(diagnostics.body).toContain('<div id="root">');

      const corrupt = await plain.probe(`/__test/boards/${newBoardId()}/corrupt-snapshot`, 'POST');
      expect(corrupt.body).not.toContain('snapshotThrough');
    } finally {
      await plain.stop();
    }
  });
});

test.describe('how long a board takes to come back', () => {
  test('TC-20 a board of two thousand notes is on screen within three seconds @nightly', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const boardId = await server.createBoard();
    const page = await openAt(server, browser, boardId);

    // A board of the size the setting names, built in edits of `NOTES_PER_EDIT` at a
    // time. Whether the room has folded its log into a snapshot by now is its own
    // decision (TC-21 covers the compacted shape); what is measured here is reading a
    // board of this size back from storage and putting it on screen.
    const NOTES_PER_EDIT = 25;
    for (let index = 0; index < PERSIST_TESTED_NOTES / NOTES_PER_EDIT; index++)
      await createNotes(page, NOTES_PER_EDIT);
    await expect
      .poll(() => noteCount(page), { timeout: 180_000 })
      .toBe(PERSIST_TESTED_NOTES);
    const before = await content(page);

    await storedByRoom(server, browser, page, boardId, 180_000);

    // The process dies, so nothing of the board is in memory any more, and only
    // then does the clock start: what is being measured is reading a stored board
    // back and putting it on screen.
    await server.restart();
    const started = Date.now();
    const reopened = await openAt(server, browser, boardId);
    await expect
      .poll(() => noteCount(reopened), { timeout: 60_000 })
      .toBe(PERSIST_TESTED_NOTES);
    const elapsedMs = Date.now() - started;

    expect(await content(reopened)).toEqual(before);
    // Reported in the same shape as story 3's latency lines, so a reviewer sees the
    // number the run produced and not only that it cleared a limit.
    console.log(
      `[load] ${PERSIST_TESTED_NOTES} notes on screen: ${elapsedMs}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`,
    );
    // This is the one case whose expected outcome *is* the budget - the design's
    // "open within BOARD_LOAD_BUDGET_MS" - so unlike a functional test's latency
    // report it is asserted: with the timing unasserted, this case would only prove
    // the board eventually arrives.
    expect(elapsedMs).toBeLessThan(BOARD_LOAD_BUDGET_MS);

    await reopened.close();
    await page.close();
  });
});
