import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { retroBoard, batchUpdates } from '../fixtures/boards';
import {
  createBoardViaApi,
  openBoard,
} from './helpers/board';
import { noteList, waitForBoardConnection, waitForNoteCount, waitForSameBoard } from './helpers/live';
import { createNoteAt, getNotes } from './helpers/sticky';
import { WranglerProcess, callHook } from './helpers/wrangler-process';

/**
 * Story 5 end-to-end: a board is created, its link is handed to somebody else,
 * and a link that leads nowhere says so.
 *
 * The link is the whole feature, so these tests move between pages and between
 * browser contexts the way two people do - never by reaching into the app.
 */

const E2E_PORT = Number(process.env.VIDI6_E2E_PORT ?? 24064);
const ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

const boardIdOf = (page: Page): string => new URL(page.url()).pathname.slice('/b/'.length);

/** The Share panel, open, and the link it shows. */
async function openShare(page: Page): Promise<string> {
  await page.getByTestId('share-button').click();
  const panel = page.getByTestId('share-panel');
  await expect(panel).toBeVisible();
  return (await page.getByTestId('share-link').inputValue());
}

test.describe('sharing a board by link', () => {
  test('TC-26: create a board, copy its link, and a second person joins the same board (workflow 1)', async ({
    context,
    browser,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });

    const maya = await context.newPage();
    await maya.goto('/');

    // The home page's one action: click, and a board opens.
    const clickedAt = Date.now();
    await maya.getByTestId('new-board').click();
    await expect(maya.getByTestId('board')).toBeVisible();
    const clickToBoardMs = Date.now() - clickedAt;
    console.log(
      `TC-26 click to board: ${clickToBoardMs} ms (CREATE_BUDGET_MS = ${CREATE_BUDGET_MS} ms, logged not asserted)`,
    );
    await expect(maya).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/u);
    await waitForBoardConnection(maya);
    const board = boardIdOf(maya);

    // It is a new board: nothing on it.
    expect(await getNotes(maya)).toHaveLength(0);

    // A note, then the link, then the copy.
    const mayaNote = await createNoteAt(maya, { x: 120, y: 90 });
    const link = await openShare(maya);
    expect(link).toBe(`${ORIGIN}/b/${board}`);
    await maya.getByTestId('share-copy').click();
    await expect(maya.getByTestId('share-copy')).toHaveText('Link copied');
    const clipboard = await maya.evaluate(async () => await navigator.clipboard.readText());
    expect(clipboard).toBe(link);

    // Somebody else, another context, the address that was copied.
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await sam.goto(clipboard);
    await expect(sam.getByTestId('board')).toBeVisible();
    await waitForBoardConnection(sam);
    await waitForNoteCount(sam, 1);
    expect((await getNotes(sam)).some((note) => note.id === mayaNote)).toBe(true);

    // And it is the same board for both: Sam edits it, Maya sees the edit.
    const samNote = await createNoteAt(sam, { x: 240, y: 140 });
    await waitForNote(maya, samNote);
    await waitForSameBoard([maya, sam]);

    await samContext.close();
  });

  test('TC-27: a link to a board that does not exist says so, and offers a way onwards (workflow 2)', async ({
    page,
  }) => {
    const missing = newBoardId(); // well formed, and never created
    await page.goto(`/b/${missing}`);

    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByTestId('not-found-page')).toContainText('Board not found');
    await expect(page.locator('[data-testid="board"]')).toHaveCount(0);

    // Starting a board from here works, and it is a different board.
    await page.getByTestId('new-board').click();
    await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/u);
    await expect(page.getByTestId('board')).toBeVisible();
    expect(boardIdOf(page)).not.toBe(missing);
  });

  test('TC-28: the page says it is checking, then it says it cannot reach the board, then the board opens (boundary "board page before check resolves")', async ({
    page,
  }) => {
    const board = await createBoardViaApi(page);

    // The existence request is held and then dropped, so both waiting states can
    // be read: the one while it is still in the air, and the one after it failed.
    let attempts = 0;
    await page.route('**/api/boards/*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.continue();
        return;
      }
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      if (attempts === 1) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto(`/b/${board}`);

    // Waiting, and nothing that would have to be taken back.
    const checking = page.getByTestId('board-checking');
    await expect(checking).toBeVisible();
    await expect(checking).toContainText('Opening board…');
    await expect(page.locator('[data-testid="board"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sticky-note-"]')).toHaveCount(0);

    // The attempt failed, and the page says so in the way that keeps the address.
    const unreachable = page.locator('[data-testid="board-checking"][data-check-state="unreachable"]');
    await expect(unreachable).toBeVisible();
    await expect(unreachable).toContainText("Couldn't reach vidi6. Retrying…");
    await expect(page.locator('[data-testid="not-found-page"]')).toHaveCount(0);

    // The next attempt gets through, without anybody reloading.
    await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('share-button')).toBeVisible();
    expect(boardIdOf(page)).toBe(board);
  });

  test('TC-29: when the browser refuses the clipboard the link is still copyable by hand (workflow 4)', async ({
    context,
    browser,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({
          writeText: () => Promise.reject(new Error('NotAllowedError')),
        }),
      });
    });

    const page = await context.newPage();
    const board = await openBoard(page);
    const link = await openShare(page);
    expect(link).toBe(`${ORIGIN}/b/${board}`);

    await page.getByTestId('share-copy').click();
    await expect(page.getByTestId('share-manual')).toBeVisible();
    await expect(page.getByTestId('share-manual')).toContainText('Copy the link above');

    // The field is showing the link with all of it selected, ready for Ctrl/Cmd+C.
    const selection = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="share-link"]');
      if (!input) {
        throw new Error('the share field is not on the page');
      }
      return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length };
    });
    expect(selection).toEqual({ start: 0, end: link.length, length: link.length });
    await expect(page.getByTestId('share-link')).toBeFocused();

    // Nothing about the board changed: the same link still takes someone else there.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await other.goto(link);
    await expect(other.getByTestId('board')).toBeVisible();
    await waitForBoardConnection(other);

    await otherContext.close();
  });
});

test.describe('a board that was made before links existed (share.legacy_boards)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'this one runs its own Worker and restarts it; run it once',
  );
  test.describe.configure({ mode: 'serial' });

  let server: WranglerProcess;

  test.afterAll(async () => {
    await server?.stop();
  });

  test('TC-31: story 4 storage without a creation marker still opens, survives a restart, and can be shared (workflow 6)', async ({
    page,
  }) => {
    // Two Worker processes, each with its own start-up, in one test.
    test.setTimeout(180_000);

    server = await WranglerProcess.start({ label: 'legacy', testHooks: true });

    const fixture = retroBoard();
    const board = newBoardId();
    const updates = batchUpdates(fixture.updates, 3).map(
      (update) => Buffer.from(update).toString('base64'),
    );

    // Story 4 rows only: content in the log, and no `created_at` anywhere.
    const seeded = await callHook(server, board, 'seed-legacy', 'POST', { updates });
    expect(seeded.ok).toBe(true);
    expect(seeded.rows).toBe(updates.length);

    // The existence check says what the story 5 contract says it must.
    const check = await fetch(`${server.url}/api/boards/${board}`);
    expect(check.status).toBe(200);
    expect((await check.json()) as { id: string }).toEqual({ id: board });

    // The link opens the board it names, with its notes on it.
    await openBoard(page, { boardId: board, origin: server.url });
    await waitForBoardConnection(page);
    const notes = await waitForSameBoard([page]);
    expect(noteList(notes)).toEqual(noteList(fixture.notes));

    // It is shareable: the panel offers its address.
    const link = await openShare(page);
    expect(link).toBe(`${server.url}/b/${board}`);

    // Somebody edits it.
    const added = await createNoteAt(page, { x: 40, y: 40 });
    await waitForNote(page, added);

    // The process is stopped, and started again against the same storage directory.
    await server.restart();

    const reopened = await page.context().newPage();
    await openBoard(reopened, { boardId: board, origin: server.url });
    await waitForBoardConnection(reopened);
    const after = await waitForSameBoard([reopened]);
    expect(after.some((note) => note.id === added)).toBe(true);
    expect(after.length).toBe(fixture.notes.length + 1);

    const again = await fetch(`${server.url}/api/boards/${board}`);
    expect(again.status).toBe(200);

    await reopened.close();
  });
});

/** Wait until a note with this id is on the page. */
async function waitForNote(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await getNotes(page)).some((note) => note.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `note ${id} never appeared`,
    })
    .toBe(true);
}
