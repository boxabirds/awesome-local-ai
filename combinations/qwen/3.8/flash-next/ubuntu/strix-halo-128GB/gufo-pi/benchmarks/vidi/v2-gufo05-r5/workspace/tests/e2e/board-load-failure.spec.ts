/**
 * Story 4's worst day, in a browser (TC-24): a board that cannot be read.
 *
 * The bytes are genuinely damaged - the Worker's test-only storage hook replaces the board's folded
 * snapshot with something that is not a Yjs update - because the claim under test is what a person
 * sees when their board really cannot be loaded: not an empty board, not a spinner forever, but a
 * red line that says so, an editing surface that refuses to be used, and a page that comes back on
 * its own once the board can be read again.
 *
 * The repair happens while the tab sits there. Nothing reloads the page, clicks a dialog or touches
 * the browser: the room retries, the client syncs, and the board is simply there.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  doubleClickToCreate,
  noteCount,
  stopEditing,
  typeIntoEditor,
} from './helpers/notes';
import {
  PARTICIPANT_NAMES,
  SHARED_SERVER_HTTP,
  SHARED_SERVER_WS,
  boardUrl,
  connectionState,
  notesOf,
  type Participant,
} from './helpers/participants';
import { callStorageHook } from './helpers/storage-hooks';
import { ensureBoardOnServer, nudgeBoard, readBoard, seedBoard } from './helpers/seed-board';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  E2E_EVENTUAL_TIMEOUT_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';

const LOAD_FAILED_MESSAGE = 'This board couldn\'t be loaded. Retrying…';
/** The story's board size. */
const NOTES = 25;
/**
 * A board only folds its log into a snapshot once the log passes COMPACTION_UPDATE_COUNT rows, and
 * 25 notes is 25 rows - so the test adds small moves until the threshold is crossed. Notes stay at
 * 25; what grows is the history, which is what a board lived in for a month looks like anyway.
 */
const NUDGE_MOVES = COMPACTION_UPDATE_COUNT + 20;
/**
 * How long the board is allowed to take coming back: the room will not attempt a second read within
 * LOAD_RETRY_MIN_INTERVAL_MS, and the read is attempted because the client makes a connection, which
 * it does after a backoff that grows to RECONNECT_MAX_BACKOFF_MS. Both clocks restart on every
 * failed attempt, so three full rounds of the worst case is the allowance.
 */
const RECOVERY_TIMEOUT_MS = 3 * (LOAD_RETRY_MIN_INTERVAL_MS + RECONNECT_MAX_BACKOFF_MS);

/** Opens a tab on a board without waiting for it to be live, which a broken board never is. */
async function openTab(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const crashed: string[] = [];
  page.on('pageerror', (error) => crashed.push(String(error)));
  await page.goto(boardUrl(boardId));
  await page.waitForFunction(() => window.__vidi6 !== undefined, undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  return {
    name: PARTICIPANT_NAMES[0] ?? 'Alex',
    context,
    page,
    consoleErrors: crashed,
  };
}

/** The connection badge, by the class the whole suite uses for it (`role=status` is not unique). */
const badge = (page: Page) => page.locator('.connection-status');

/** The colour the badge text is painted in, as channels - "red" is a fact about CSS, not wording. */
async function badgeColour(page: Page): Promise<{ r: number; g: number; b: number }> {
  const value = await badge(page).evaluate((element) => getComputedStyle(element).color);
  const channels = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (!channels) throw new Error(`the badge colour is not an rgb colour: ${value}`);
  return { r: Number(channels[1]), g: Number(channels[2]), b: Number(channels[3]) };
}

const sortedTexts = (notes: readonly { text: string }[]): string[] =>
  notes.map((note) => note.text).sort();

test.describe('a board that cannot be read (TC-24)', () => {
  test('says so in red, refuses to be edited, and comes back when the bytes are fixed', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = newBoardId();

    await ensureBoardOnServer(SHARED_SERVER_HTTP, boardId);
    // a board of 25 notes, lived in enough that the room has folded it
    const seeded = await seedBoard(SHARED_SERVER_WS, boardId, NOTES);
    await nudgeBoard(SHARED_SERVER_WS, boardId, NUDGE_MOVES);

    // and now the stored snapshot is not readable any more
    const damaged = await callStorageHook(SHARED_SERVER_HTTP, boardId, 'corrupt-snapshot');
    expect(damaged.ok).toBe(true);
    expect(damaged.chunks).toBeGreaterThan(0);

    const tab = await openTab(browser, boardId);

    // the honest message, in red, saying it is being retried
    await expect(badge(tab.page), 'no red message about the board').toHaveText(
      LOAD_FAILED_MESSAGE,
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    );
    await expect(badge(tab.page)).toHaveAttribute('data-state', 'load_failed');
    const colour = await badgeColour(tab.page);
    expect(colour.r, `the badge is not red: rgb(${colour.r}, ${colour.g}, ${colour.b})`).toBeGreaterThan(120);
    expect(colour.r).toBeGreaterThan(colour.g + 40);
    expect(colour.r).toBeGreaterThan(colour.b + 40);
    expect(await connectionState(tab)).toBe('load_failed');

    // an empty board would be a lie, so it does not show one: nothing is rendered, and nothing is
    // held back to be revealed later
    expect((await notesOf(tab)).length).toBe(0);

    // and it cannot be edited, by either of the two ways a board is edited
    await expect(tab.page.getByTestId('create-sticky-button')).toBeDisabled();
    await tab.page.getByTestId('board-viewport').dblclick({ position: { x: 1050, y: 250 }, delay: 60 });
    await expect(tab.page.getByTestId('sticky-note-input')).toHaveCount(0);
    await expect.poll(() => noteCount(tab.page), { timeout: 2000 }).toBe(0);

    // fix the bytes. Nothing else is touched: no reload, no click, no dialog
    const repaired = await callStorageHook(SHARED_SERVER_HTTP, boardId, 'repair');
    expect(repaired).toEqual({ ok: true, chunks: damaged.chunks });

    await expect
      .poll(() => connectionState(tab), {
        message: `the board never came back after its storage was repaired\nlast state ${await connectionState(tab)}`,
        timeout: RECOVERY_TIMEOUT_MS,
      })
      .toBe('connected');
    await expect(badge(tab.page)).toHaveCount(0);
    await expect
      .poll(async () => sortedTexts(await notesOf(tab)), {
        message: 'the board came back, but not with the notes that were on it',
        timeout: RECOVERY_TIMEOUT_MS,
      })
      .toEqual(sortedTexts(seeded));

    // editing works again by itself
    await expect(tab.page.getByTestId('create-sticky-button')).toBeEnabled();
    await doubleClickToCreate(tab.page, { x: 1050, y: 250 });
    await typeIntoEditor(tab.page, 'back, and writable');
    await stopEditing(tab.page);
    await expect
      .poll(async () => (await notesOf(tab)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(NOTES + 1);

    // and the note written after the recovery is on the board rather than only on the screen
    await expect
      .poll(
        async () => (await readBoard(SHARED_SERVER_WS, boardId)).length,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(NOTES + 1);

    expect(tab.consoleErrors, 'a broken board must not crash the page').toEqual([]);
    await tab.context.close();
  });
});
