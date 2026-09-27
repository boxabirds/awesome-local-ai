/**
 * tests/e2e/persistence.spec.ts
 *
 * Story 4's end-to-end pair: a board that outlives its server, and a board big
 * enough that loading it is something you can notice (TC-19, TC-20, TC-21).
 *
 * These are the tests the in-process integration suite cannot replace. Those
 * drive the Durable Object directly, which is how they can damage a snapshot and
 * inject a storage failure; here nothing is stubbed, and the server is a real
 * `wrangler dev` in its own process, over its own directory of SQLite, which the
 * test is free to kill. Killing it is the subject: `persist.across_restart`
 * means the board is on disk and nobody's memory, and the only proof is a server
 * that died with the board in it and came back without knowing it had been
 * serving anybody.
 *
 * `npm run test:e2e` needs the `persistence` project for this file: the shared
 * dev server would be one board and one process, and killing it would take the
 * rest of the suite with it.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { largeBoard } from '../fixtures/boards';
import { waitForRender } from './helpers/board';
import { seedBoard } from './helpers/board-socket';
import { connectionState, notesOn } from './helpers/participants';
import { startDevServer, type DevServer } from './helpers/wrangler-process';

/** One server per test: a test that kills it must not kill anybody else's. */
const persistenceTest = test.extend<{ server: DevServer }>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startDevServer();
    try {
      await use(server);
    } finally {
      await server.stop();
    }
  },
});

/** One test starting a server at a time: they are processes, not mocks. */
persistenceTest.describe.configure({ mode: 'serial' });

persistenceTest.describe('story 4: returning to a board', () => {
  persistenceTest('TC-19 twenty-five notes left overnight are exactly as they were left', async ({
    browser,
    server,
  }) => {
    const boardId = newBoardId();
    const left = await persistenceTest.step('leave the board', async () => {
      const person = await openBoard(browser, server, boardId);
      try {
        await makeVariedNotes(person.page, 25);
        return await notesOn(person.page);
      } finally {
        await person.context.close();
      }
    });

    // The overnight: a server that has forgotten everything, over the same disk.
    await server.restart();

    const returner = await openBoard(browser, server, boardId);
    try {
      await expect
        .poll(async () => (await notesOn(returner.page)).length, { timeout: 30_000 })
        .toBe(25);
      expect(await notesOn(returner.page)).toEqual(left);
    } finally {
      await returner.context.close();
    }
  });

  persistenceTest('TC-20 a change a second person has seen is a change the server has kept', async ({
    browser,
    server,
  }) => {
    const boardId = newBoardId();
    const alex = await openBoard(browser, server, boardId);
    const sam = await openBoard(browser, server, boardId);


    await alex.page.getByTestId('create-sticky').click();
    await waitForRender(alex.page);
    const [note] = await notesOn(alex.page);
    if (note === undefined) throw new Error('the note was not created');

    // A room stores before it broadcasts, so the moment Sam sees it, it is kept.
    await expect
      .poll(async () => (await notesOn(sam.page)).some((other) => other.id === note.id), {
        timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
        message: 'the note did not reach the second person',
      })
      .toBe(true);
    const seenAt = Date.now();

    // And within a second of that, there is no server and nobody watching it.
    await alex.context.close();
    await sam.context.close();
    await server.stop({ hard: true });
    expect(
      Date.now() - seenAt,
      'closing both windows and killing the server took longer than the requirement allows',
    ).toBeLessThanOrEqual(1_000);

    await server.restart();
    const watcher = await openBoard(browser, server, boardId);
    try {
      await expect
        .poll(async () => (await notesOn(watcher.page)).some((other) => other.id === note.id), {
          timeout: 30_000,
          message: 'the note a second person had seen was not on the board after the restart',
        })
        .toBe(true);
    } finally {
      await watcher.context.close();
    }
  });

  persistenceTest('TC-21 opening a board at its tested size shows every note inside the budget', async ({
    browser,
    server,
  }) => {
    const boardId = newBoardId();
    // Built through the room itself, not through the toolbar: two thousand notes
    // typed one at a time would be measuring the keyboard.
    await seedBoard(server.roomUrl(boardId), (doc) => {
      largeBoard(doc, PERSIST_TESTED_NOTES);
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto(`${server.url}/b/${boardId}`);
      await page
        .waitForFunction(
          (count) => document.querySelectorAll('[data-testid="sticky-note"]').length === count,
          PERSIST_TESTED_NOTES,
          { timeout: 60_000 },
        );
      // `performance.now()` is measured from this navigation, which is exactly
      // the span the requirement is about: address to a board you can see.
      const elapsed = await page.evaluate(() => Math.round(performance.now()));
      expect(
        elapsed,
        `${String(PERSIST_TESTED_NOTES)} notes took ${String(elapsed)}ms to show, budget is ${String(BOARD_LOAD_BUDGET_MS)}ms`,
      ).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
    } finally {
      await context.close();
    }
  });
});

/**
 * A board of this size has to be on screen before the budget has run out, so the
 * budget is measured from the navigation, not from the socket opening: the
 * document has to arrive, be applied, and be painted.
 */
async function openBoard(
  browser: Browser,
  server: DevServer,
  boardId: string,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${server.url}/b/${boardId}`);
  await expect(page.getByTestId('board'), 'the board did not render').toBeVisible();
  await expect
    .poll(() => connectionState(page), { timeout: 30_000, message: 'the board did not connect' })
    .toBe('connected');
  return { page, context };
}

/**
 * Twenty-five notes that differ from each other in the ways the requirement
 * lists: text, colour, position, stacking.
 *
 * Every one of them is made the way a person makes a note — the toolbar button,
 * the keyboard, a drag — because what is being promised is that what you made is
 * what comes back.
 */
async function makeVariedNotes(page: Page, count: number): Promise<void> {
  const colours = ['Pink colour', 'Yellow colour', 'Blue colour', 'Green colour'];
  for (let index = 0; index < count; index += 1) {
    await page.getByTestId('create-sticky').click();
    await waitForRender(page);
    const notes = await notesOn(page);
    const made = notes[notes.length - 1];
    if (made === undefined) throw new Error('the toolbar did not make a note');

    // Text.
    await page.keyboard.press('Enter');
    await waitForRender(page);
    await page.keyboard.type(`note ${String(index + 1)}`);
    await page.keyboard.press('Escape');
    await waitForRender(page);

    // Position: spread them over the board rather than in one pile.
    const box = await page.locator(`[data-testid="sticky-note"][data-id="${made.id}"]`).boundingBox();
    if (box !== null) {
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + ((index % 5) - 2) * 90, from.y + (index % 8) * 70, { steps: 4 });
      await page.mouse.up();
      await waitForRender(page);
    }

    // Colour, every fourth note.
    if (index % 4 === 3) {
      const colour = colours[(index / 4) % colours.length];
      if (colour !== undefined) {
        await page.locator(`[data-testid="sticky-note"][data-id="${made.id}"]`).click();
        await page.getByRole('button', { name: colour }).click();
        await waitForRender(page);
      }
    }
  }
}
