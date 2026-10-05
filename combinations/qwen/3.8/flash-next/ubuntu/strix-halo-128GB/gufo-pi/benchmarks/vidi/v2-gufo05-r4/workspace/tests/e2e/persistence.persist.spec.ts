/**
 * Story 4 in a browser, across a process that forgets everything.
 *
 * The integration tests can evict a Durable Object; this is the other half — the
 * browser, the built client, the real `wrangler dev` process, and that process being
 * killed. What the product promises is that a board you left is the board you come
 * back to, and the only honest way to test that is to make sure nothing is left
 * anywhere but in storage.
 *
 * These cases therefore run against a dev server of their own
 * (`helpers/wrangler-process.ts`, its own port and its own `--persist-to` directory)
 * rather than the run's shared one, which they would only get in the way of: killing
 * the shared server would stop every other spec. The project runs serially on chromium,
 * because what is under test is the process and its storage, not a browser engine.
 *
 * Timings are reported, not asserted — except the one that is this file's own
 * discipline: TC-20 pulls the plug within a second of the change being visible, and
 * says plainly if it fails to.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  STICKY_SIZE_WORLD,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor
} from '../../src/shared/config';
import { doubleClickBoard, dragNote, note, notes, setCamera, swatch } from './helpers/board';
import { boardOf, createBoardOn, openBoardAt, openSession } from './helpers/participants';
import { seedBoard } from './helpers/board-writer';
import { startBoardServer, type BoardServer } from './helpers/wrangler-process';

const PORT = 21332;
const INSPECTOR_PORT = 21333;
const VIEWPORT = { width: 1280, height: 800 };

/** The dev server these tests switch off and back on. */
let server: BoardServer;
/** Where its storage lives — deliberately the same across restarts. */
let persistTo: string;

test.beforeAll(async () => {
  persistTo = await mkdtemp(joinPath(tmpdir(), 'vidi6-persistence-'));
  server = await startBoardServer({ persistTo, port: PORT, inspectorPort: INSPECTOR_PORT });
});

test.afterAll(async () => {
  await server?.stop();
  await rm(persistTo, { recursive: true, force: true });
});

/** Kill the process, and start another one over the same storage. */
async function restartTheProcess(): Promise<void> {
  await server.stop();
  server = await startBoardServer({ persistTo, port: PORT, inspectorPort: INSPECTOR_PORT });
}

/** One person, in a context of their own, at a board that may or may not exist yet. */
async function openOne(browser: Browser, boardId: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  pageerror: ${error.message}`));
  await openBoardAt(page, boardId, server.origin);
  return { context, page };
}

/** Click board space where no note is, which ends editing without making anything. */
async function clickAway(page: Page): Promise<void> {
  await page.mouse.click(40, 420);
}

/**
 * The 25 notes TC-19 leaves behind, made through the user interface: double-click for a
 * note, type or deliberately leave it empty, give some of them a colour of their own,
 * and drag two of them later. So text, colour, position and stacking are all things that
 * have to come back, not merely rows in a table.
 */
async function makeTwentyFiveNotes(page: Page): Promise<void> {
  const colours = Object.keys(STICKY_COLORS);
  const sentences = [
    'Ship small, ship often',
    'The board is the document',
    'Nothing is finished until it is saved',
    'Ask a quieter question',
    'Cut the thing nobody opens'
  ];
  // Zoomed out, so 25 notes fit on one screen with clear board between them — which
  // matters, because a double-click on an existing note edits it instead of making a new
  // one. At zoom 0.45 a note is 90 pixels across, and a 140-pixel lattice leaves 50.
  const ZOOM = 0.45;
  await setCamera(page, { x: 0, y: 0, zoom: ZOOM });
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      await doubleClickBoard(page, 200 + column * 140, 130 + row * 140);
      // Every third note stays blank: an empty note is a state of the board too.
      if (index % 3 !== 2) await page.keyboard.type(`${index + 1}. ${sentences[index % sentences.length]}`);
      await clickAway(page);
      if (index % 3 === 1) {
        await note(page, index).click();
        await swatch(page, colours[(Math.floor(index / 3) + 1) % colours.length], index).click();
        await clickAway(page);
      }
      index += 1;
    }
  }

  // Stacking has to survive as well, so move two notes that are already there: dragging
  // raises what is dragged, which changes the order the board draws the notes in.
  await dragNote(page, 0, 30, 20);
  await dragNote(page, 1, -25, 35);
  await expect.poll(() => notes(page).count(), { message: '25 notes are on the board' }).toBe(25);
}

/** The notes as the DOM draws them, minus selection, which is not board state. */
async function screenWithoutSelection(page: Page): Promise<string[]> {
  return page.$$eval('[data-vidi6="sticky"]', (elements: HTMLElement[]) =>
    elements.map((element) =>
      [
        element.dataset.noteId ?? '',
        element.dataset.x ?? '',
        element.dataset.y ?? '',
        element.dataset.color ?? '',
        (element.textContent ?? '').trim()
      ].join(' | ')
    )
  );
}

test.describe('coming back to a board', () => {
  // TC-19
  test('a board left overnight is the board you come back to', async ({ browser }) => {
    test.setTimeout(300_000);
    // Made through the API first: this is the board somebody came back to, so somebody
    // has to have made it.
    const boardId = await createBoardOn(server.origin);

    const { context, page } = await openOne(browser, boardId);
    await makeTwentyFiveNotes(page);
    const left = (await boardOf(page)) as StickySnapshot[];
    const onScreen = await screenWithoutSelection(page);
    expect(left).toHaveLength(25);
    expect(new Set(left.map((row) => row.id)).size).toBe(25);
    expect(left.some((row) => row.text === '')).toBe(true);
    expect(new Set(left.map((row) => row.color)).size).toBeGreaterThan(1);

    // The browser goes away, and so does everything it was holding.
    await context.close();
    await restartTheProcess();

    const back = await openOne(browser, boardId);
    await expect
      .poll(() => boardOf(back.page).then((rows) => rows.length), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the board comes back with all 25 notes'
      })
      .toBe(25);

    // Identical, not merely the same size: text, colour, position, stacking.
    expect(await boardOf(back.page)).toEqual(left);
    await expect
      .poll(() => screenWithoutSelection(back.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the screen draws the same board it drew yesterday'
      })
      .toEqual(onScreen);

    await back.context.close();
  });

  // TC-20
  test('a change somebody else saw is already in storage', async ({ browser }) => {
    test.setTimeout(300_000);
    const session = await openSession(browser, ['alex', 'sam'], { origin: server.origin });
    const alex = session.person('alex').page;

    await doubleClickBoard(alex, 520, 360);
    await alex.keyboard.type('written and gone a second later');
    await clickAway(alex);

    await session.eventually('sam sees the note', async () => {
      const rows = (await boardOf(session.person('sam').page)) as StickySnapshot[];
      return rows.length === 1 || `sam holds ${rows.length} note(s)`;
    });
    const seen = (await boardOf(alex)) as StickySnapshot[];
    expect(seen).toHaveLength(1);

    // Pull the plug: both people go, and the process is killed rather than shut down.
    const seenAt = Date.now();
    await session.close();
    await server.stop();
    const killedAfterMs = Date.now() - seenAt;

    server = await startBoardServer({ persistTo, port: PORT, inspectorPort: INSPECTOR_PORT });

    const back = await openOne(browser, session.boardId);
    await expect
      .poll(() => boardOf(back.page).then((rows) => rows.length), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the note that was only ever on a screen is on the board again'
      })
      .toBe(1);
    expect(await boardOf(back.page)).toEqual(seen);
    await back.context.close();

    console.log(
      `  TC-20: process killed ${killedAfterMs}ms after the change was visible. The story asks for under ` +
        '1000ms: that is this test pulling the plug promptly, not the product being fast.'
    );
    expect(killedAfterMs, 'the test itself was slow to close the contexts and kill the process').toBeLessThan(1_000);
  });

  // TC-21
  test('a big board opens completely', async ({ browser }) => {
    test.setTimeout(600_000);
    // Made through the API first. A room will not invent a board any more — that is story 5's
    // whole point — so a socket to an address nobody created is closed, and the seeding below
    // would be writing into a refusal.
    const boardId = await createBoardOn(server.origin);
    const colours = Object.keys(STICKY_COLORS) as StickyColor[];

    // Where the notes are going, decided before any of them exists, so "opened
    // completely" is checked against what was put in rather than against a count.
    const wanted = Array.from({ length: PERSIST_TESTED_NOTES }, (_blank, index) => ({
      x: (index % 40) * 260,
      y: Math.floor(index / 40) * 240,
      color: colours[index % colours.length]
    }));

    // Seeded without a browser: 2000 notes through the same wire format and the same
    // mutators, confirmed by a second connection before anything is asserted.
    await seedBoard(
      server.origin,
      boardId,
      (doc) => {
        for (const place of wanted) createSticky(doc, { x: place.x, y: place.y }, place.color);
      },
      PERSIST_TESTED_NOTES
    );

    const startedAt = Date.now();
    const { context, page } = await openOne(browser, boardId);
    // The functional outcome: every note the board holds is drawn.
    await expect
      .poll(() => notes(page).count(), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `all ${PERSIST_TESTED_NOTES} notes are rendered`
      })
      .toBe(PERSIST_TESTED_NOTES);
    const renderedMs = Date.now() - startedAt;

    // And they are the notes that were put there, in the places they were put.
    const opened = (await boardOf(page)) as StickySnapshot[];
    expect(opened).toHaveLength(PERSIST_TESTED_NOTES);
    // `createSticky` is given a centre and stores a top-left, so the comparison says so
    // rather than fudging the numbers into agreement.
    expect(
      opened.map((row) => ({
        x: row.x + STICKY_SIZE_WORLD / 2,
        y: row.y + STICKY_SIZE_WORLD / 2,
        color: row.color
      }))
    ).toEqual(wanted);
    await context.close();

    console.log(
      `  TC-21: ${PERSIST_TESTED_NOTES} notes from navigation to fully rendered in ${renderedMs}ms ` +
        `(BOARD_LOAD_BUDGET_MS is ${BOARD_LOAD_BUDGET_MS}ms — reported, not asserted)`
    );
  });
});
