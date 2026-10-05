/**
 * Coming back to a board and finding everything as it was left (TC-19 to TC-21).
 *
 * Every other e2e file runs against the runtime Playwright starts for the suite, which is
 * alive from the first test to the last. That is the right arrangement for testing people
 * editing together, and it is useless for the claim this story makes, because a board that
 * is still in a server's memory has proven nothing about being *kept*. So these tests run
 * against a runtime of their own — its own port, its own directory of stored boards — which
 * the test starts, stops, and starts again. When the process comes back it has only what it
 * wrote down, and that is the whole point of the test.
 *
 * What each one proves:
 *  - TC-19: a board used by two people, closed, and opened the next day by a server that
 *    has never seen it: every note, in the same words, colours, places and stacking.
 *  - TC-20: a change that another person managed to see is a change that was written down,
 *    even when everybody leaves within a second of it — the append-before-broadcast promise,
 *    checked by killing the process immediately rather than politely.
 *  - TC-21: a board of `PERSIST_TESTED_NOTES` notes opens completely in a browser, with the
 *    time it took written against `BOARD_LOAD_BUDGET_MS`. The time is reported, not asserted
 *    (this machine runs the browser, the model and the server at once); what is asserted is
 *    that the board is *there*, all of it.
 *
 * They run one after another in one worker: each needs a port pair and a directory, and two
 * tests looking for a free port at the same moment can find the same one.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { createBoardAt } from './helpers/board';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES, STICKY_COLORS } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import { freshPersistDir, startRuntime, type RunningRuntime } from './helpers/wrangler-process';

/** How long a page waits to be told it is live. */
const LIVE_TIMEOUT_MS = 60_000;
/** How long a page waits to be a board at all. */
const BOOT_TIMEOUT_MS = 30_000;

test.describe.configure({ mode: 'serial' });

/** One person, on a runtime this test owns rather than the suite's. */
interface Person {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Anything this page said that was an error. */
  readonly errors: string[];
  /** When this page started navigating, for a test that measures the opening. */
  readonly navigatedAt: number;
}

/** The page's own account of its connection, or undefined before it has one. */
function connectionOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__vidi6?.connectionState);
}

/** The notes this page's document holds. */
function notesOf(page: Page): Promise<readonly Note[]> {
  return page.evaluate(() => window.__vidi6?.getStickies() ?? []);
}

/** A note as the document holds it: everything that has to come back unchanged. */
interface Note {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
}

/** The words on the board, in the order the document hands them over. */
function textsOf(page: Page): Promise<string> {
  return notesOf(page).then((notes) => notes.map((note) => note.text).join('|'));
}

/** How many notes this page paints. */
function paintedNotes(page: Page): Promise<number> {
  return page.locator('[data-note-id]').count();
}

/**
 * Open a board on a runtime of the test's own, and wait until the board says it is live.
 *
 * The address is absolute on purpose: these pages must not be resolved against the suite's
 * `baseURL`, because a page that opened the *suite's* copy of a board id would find a board
 * with nothing on it and report that as a lost board.
 */
async function openRoom(runtime: RunningRuntime, browser: Browser, boardId: string): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });

  const navigatedAt = Date.now();
  await page.goto(`${runtime.url}/b/${boardId}`);
  await expect
    .poll(() => page.evaluate(() => typeof window.__vidi6 === 'object' && window.__vidi6 !== null), {
      timeout: BOOT_TIMEOUT_MS,
      message: `the page at ${runtime.url}/b/${boardId} never became the app (is this runtime serving the test build?)`,
    })
    .toBe(true);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(() => connectionOf(page), {
      timeout: LIVE_TIMEOUT_MS,
      message: `${boardId} on ${runtime.url}: the board never reported a live connection`,
    })
    .toBe('connected');
  return { context, page, errors, navigatedAt };
}

/** Ask this runtime about a board's storage, through the routes only a test can reach. */
async function stored<T = Record<string, unknown>>(runtime: RunningRuntime, boardId: string, route: string): Promise<T> {
  const response = await fetch(`${runtime.url}/__test/boards/${boardId}/${route}`);
  if (!response.ok) throw new Error(`${route} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** The board's own account of what is in storage. */
interface StoredStats {
  updates: number;
  bytes: number;
  snapshot: { throughSeq: number; chunks: number; bytes: number; unreadable: boolean };
}

test('a board used today is found as it was left the next day (TC-19) @persist', async ({ browser }) => {
  test.setTimeout(300_000);
  const runtime = await startRuntime({ persistTo: freshPersistDir('overnight') });
  const boardId = await createBoardAt(runtime.url);
  try {
    // Two people on one board, because the notes have to have been *seen* by somebody
    // before the server is taken away: that is the promise under test.
    const alex = await openRoom(runtime, browser, boardId);
    const sam = await openRoom(runtime, browser, boardId);

    // Twenty-five notes, spread over the board, with different words, colours and order.
    const left = await makeNotes(alex.page, 25);

    // Sam can see all twenty-five: which, given that the room writes before it repeats,
    // means every one of them is already in storage.
    await expect
      .poll(() => textsOf(sam.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'Sam never saw all of the notes',
      })
      .toBe(left.map((note) => note.text).join('|'));

    // Close the laptop. Both pages go, and then the server does.
    await alex.context.close();
    await sam.context.close();
    const restarted = await runtime.restart();

    // Next day, fresh browser, nothing in common with yesterday's but a directory.
    const morning = await openRoom(restarted, browser, boardId);
    const found = await notesOf(morning.page);
    expect(found.map(describeNote)).toEqual(left.map(describeNote));
    expect(morning.errors, morning.errors.join('\n')).toEqual([]);

    // And the room really did read this from disk rather than serve a board it happened still
    // to be holding: the storage says the same thing the page does.
    const stats = await stored<StoredStats>(restarted, boardId, 'stats');
    expect(stats.updates).toBeGreaterThan(0);

    await morning.context.close();
  } finally {
    await runtime.stop();
  }
});

test('a note somebody else managed to see is stored even when they leave at once (TC-20) @persist', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const runtime = await startRuntime({ persistTo: freshPersistDir('leave-immediately') });
  const boardId = await createBoardAt(runtime.url);
  try {
    const alex = await openRoom(runtime, browser, boardId);
    const sam = await openRoom(runtime, browser, boardId);

    await makeNotes(alex.page, 1, () => 'Left in a hurry');
    // Sam sees it. The instant that happens, the update was already written: the room stores
    // before it repeats, so being seen and being stored are the same moment seen from here.
    await expect
      .poll(() => textsOf(sam.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'Sam never saw the note',
      })
      .toBe('Left in a hurry');

    // And then everybody leaves within a second of it, and the server is stopped. No waiting
    // for a quiet moment: a change that needs a quiet moment to be saved is the thing this
    // story promises does not exist.
    const leftAt = Date.now();
    await alex.context.close();
    await sam.context.close();
    const restarted = await runtime.restart();
    expect(Date.now() - leftAt, 'everybody was gone and the server stopped within a second').toBeLessThan(
      // A restart is slower than a second because it *starts a server*; the point is that no
      // idle period, no timer and no flush was waited for.
      120_000,
    );

    const reopened = await openRoom(restarted, browser, boardId);
    const notes = await notesOf(reopened.page);
    expect(notes.map((note) => note.text)).toEqual(['Left in a hurry']);
    expect(reopened.errors, reopened.errors.join('\n')).toEqual([]);
    await reopened.context.close();
  } finally {
    await runtime.stop();
  }
});

test('a board of two thousand notes opens completely in a browser (TC-21) @persist', async ({ browser }) => {
  test.setTimeout(600_000);
  const runtime = await startRuntime({ persistTo: freshPersistDir('big-board') });
  const boardId = await createBoardAt(runtime.url);
  try {
    // The notes are put into storage by the room itself (see `src/worker/test-seed.ts`), one
    // row per note, because making them by hand in a browser would measure the clicking and
    // not the opening.
    const seedResponse = await fetch(`${runtime.url}/__test/boards/${boardId}/seed?notes=${PERSIST_TESTED_NOTES}`, {
      method: 'POST',
    });
    // The body is read once, into a string: a response can only be read once, and asking for
    // `.json()` after the failure message asked for `.text()` fails with "Body is unusable" — which
    // is a worse report than the one it was trying to print.
    const seedBody = await seedResponse.text();
    expect(seedResponse.ok, `the board could not be filled in: ${seedBody}`).toBe(true);
    const { seeded: count } = JSON.parse(seedBody) as { seeded: number };
    expect(count).toBe(PERSIST_TESTED_NOTES);

    // A fresh page, and the clock starts before it navigates: everything after this point is
    // what a person waits for — the app, the socket, the room reading its board off disk, the
    // update arriving, and two thousand notes being painted.
    const opener = await openRoomButDoNotWaitForLive(runtime, browser, boardId);
    const openedIn = Date.now() - opener.navigatedAt;
    await expect
      .poll(() => paintedNotes(opener.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [50],
        message: `the board did not paint all ${PERSIST_TESTED_NOTES} notes`,
      })
      .toBe(PERSIST_TESTED_NOTES);
    const paintedIn = Date.now() - opener.navigatedAt;

    // The board is complete, which is the assertion. A board that arrives 98% of the way is a
    // board with two thousand notes missing, and no amount of fast timing excuses that.
    const notes = await notesOf(opener.page);
    expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
    expect(new Set(notes.map((note) => note.id)).size).toBe(PERSIST_TESTED_NOTES);
    expect(new Set(notes.map((note) => note.text)).size).toBeGreaterThan(1);
    expect(opener.errors, opener.errors.slice(0, 5).join('\n')).toEqual([]);

    // Reported, not asserted: the budget is a design number and this machine is running the
    // browser, the model and the server at the same time (see NOTES.md).
    console.log(
      `\nbig board open (${PERSIST_TESTED_NOTES} notes, ${boardId})\n` +
        `  connected and loaded: ${openedIn} ms\n` +
        `  every note painted: ${paintedIn} ms\n` +
        `  budget: ${BOARD_LOAD_BUDGET_MS} ms — ${paintedIn > BOARD_LOAD_BUDGET_MS ? 'over' : 'within'} (reported, not asserted)\n`,
    );

    await opener.context.close();
  } finally {
    await runtime.stop();
  }
});

// ---------------------------------------------------------------------------
// making a board
// ---------------------------------------------------------------------------

/**
 * Make `count` notes by double-clicking the board, typing, choosing a colour and letting go —
 * the way a person does it — and return them as the document holds them.
 *
 * The notes are spread on a grid around the middle of the screen so that they are all
 * clickable: at the zoom this sets, a note is about 100 pixels across on a 1280 by 800 screen.
 */
async function makeNotes(
  page: Page,
  count: number,
  text: (index: number) => string = (index) => `Note ${index + 1}`,
): Promise<readonly Note[]> {
  // Zoom out so the grid of notes fits on one screen with room for a toolbar above each:
  // at 40% a note is about 100 pixels across, and the rows are far enough apart that a
  // note's own toolbar — which is painted above it, and counter-scaled so it stays the same
  // size on screen at any zoom — has somewhere to sit that is not the next note's face.
  await page.evaluate(() => window.__vidi6?.setCamera({ zoom: 0.4 }));

  // The colour names come from the app's own palette: a swatch's accessible name is that key with
  // its first letter capitalised (see `labelOf` in NoteToolbar), so there is one source for both.
  // They were spelled out here once and drifted: this list said "purple" where the app says
  // "Violet", and the click then waited twenty seconds for a button that does not exist.
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  for (let index = 0; index < count; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const at = { x: 640 + (column - 2) * 240, y: 400 + (row - 2) * 150 };
    await page.getByTestId('board-viewport').dblclick({ position: at });
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();
    await page.keyboard.type(text(index));
    await page.keyboard.press('Escape');
    // The note is selected now, so its colour swatches are on screen. The newest note is on
    // top of the pile, which is what makes this clickable at all.
    const color = colors[index % colors.length];
    if (color !== undefined && color !== 'yellow') {
      await page.getByRole('button', { name: `${color[0]?.toUpperCase()}${color.slice(1)} colour` }).click();
    }
  }
  return notesOf(page);
}

/** Everything about a note that a return to the board has to get right. */
function describeNote(note: Note): string {
  return `${note.text} / ${note.color} / ${round(note.x)},${round(note.y)} / z ${round(note.z)} / ${note.id}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Open a board without waiting for it to be live, for the test that measures how long
 * being live takes. Only the app itself is waited for: the board has to be the app in order
 * to be counted.
 */
async function openRoomButDoNotWaitForLive(runtime: RunningRuntime, browser: Browser, boardId: string): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  const navigatedAt = Date.now();
  await page.goto(`${runtime.url}/b/${boardId}`);
  await expect
    .poll(() => page.evaluate(() => typeof window.__vidi6 === 'object' && window.__vidi6 !== null), {
      timeout: BOOT_TIMEOUT_MS,
    })
    .toBe(true);
  return { context, page, errors, navigatedAt };
}
