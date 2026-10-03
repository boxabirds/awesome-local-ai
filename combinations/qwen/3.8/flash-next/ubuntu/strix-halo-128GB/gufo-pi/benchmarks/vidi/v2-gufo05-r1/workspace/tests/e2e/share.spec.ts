/**
 * Sharing a board, in a browser.
 *
 * These are the things the story promises somebody can do, run the way they would do them:
 * press "New board", copy the link, send it, and have the person on the other end looking at
 * the same board. Nothing here inspects the app from inside — the link is read out of the
 * panel the way a person reads it, and the second browser is a genuinely separate one
 * (`browser.newContext()`: separate storage, cookies, cache, WebSocket), because a second tab
 * in the same context would pass whether or not the server relayed anything.
 *
 * The negative half matters as much as the positive: an address that names no board shows
 * "Board not found" and does not become a board by being opened. That is the difference
 * between a shareable product and one where a mistyped link silently starts a second, empty
 * meeting.
 *
 * TC numbers are the design's (spec/stories/005-…/design.md). TC-30 does not exist in that
 * list: the many-people case is story 3's TC-26 in `nightly.spec.ts`, and this story's TC-27
 * is the same claim with two people instead of a hundred.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import {
  BOARD_ID,
  boardIdFromUrl,
  checkBoard,
  createBoard,
  openFreshBoard,
} from './helpers/board';
import {
  EVENTUALLY,
  logLatencyReport,
  noteCentreOnScreen,
  openParticipant,
  readBoard,
  waitForChange,
  waitForConnection,
  type BoardNote,
} from './helpers/participants';

/**
 * Somebody who arrived with nothing but the link.
 *
 * A separate context, so nothing is shared with the person who sent it, and their console
 * watched while they are here: a board that has nothing to say about a problem should say
 * nothing, and an uncaught error on somebody's first screen is the story failing quietly.
 */
interface Visitor {
  name: string;
  context: BrowserContext;
  page: Page;
  board(): Promise<BoardNote[]>;
  errors(): string[];
}

async function openFromLink(browser: Browser, name: string, link: string): Promise<Visitor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: console.error ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`${name}: page error ${error.message}`);
  });
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await waitForConnection(page, name);
  return { name, context, page, board: () => readBoard(page), errors: () => errors };
}

/** Open the Share panel and read the address it is offering. */
async function shownLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Share' }).click();
  return await page.getByRole('textbox').inputValue();
}

test.describe('workflow: share a board with others using a link', () => {
  test('TC-26 create, share, join', async ({ page, browser, browserName }) => {
    // Chromium only, and only for the reading-back: `clipboard-read` is a capability the
    // other engines will not grant an automated browser. Every engine gets the fallback
    // proved in TC-29, and the component suite proves a refused copy never claims success.
    test.skip(browserName !== 'chromium', 'reading the clipboard back is Chromium-only');

    // Maya arrives with no board and presses the one button.
    const startedAt = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${BOARD_ID}$`));
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForConnection(page, 'Maya');
    // Reported against the budget, never asserted on it: this machine runs the model, the
    // browser and the server at once.
    console.log(
      `[timing] press to board: ${Date.now() - startedAt} ms (budget ${CREATE_BUDGET_MS} ms; reported, not asserted)`,
    );
    const maya = { name: 'Maya', page, board: () => readBoard(page) };
    // The board she lands on is empty and hers.
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
    const boardId = boardIdFromUrl(page.url());
    const origin = new URL(page.url()).origin;

    // She writes something, so there is a fact only her board holds.
    await page.mouse.dblclick(520, 300);
    await page.keyboard.type('Kickoff, from the person who made the board');
    await page.keyboard.press('Escape');
    const noteId = (await readBoard(page))[0]?.id;
    if (!noteId) throw new Error('Maya’s note did not appear on her own board');

    // The panel offers the address, and one press puts it on the clipboard.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    expect(await shownLink(page)).toBe(`${origin}/b/${boardId}`);
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    // What left the panel is what the clipboard holds — the test hands Sam that string, the
    // way a chat window would.
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${origin}/b/${boardId}`);
    // The confirmation is a moment, then the button is an offer again.
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible({
      timeout: LINK_COPIED_MS + 5_000,
    });

    // Sam signs in to nothing and has nothing else to go on.
    const sam = await openFromLink(browser, 'Sam', link);
    expect(sam.page.url()).toBe(link);
    await waitForChange('Maya’s note reaches Sam', async () =>
      (await sam.board()).some((note) => note.id === noteId),
    );

    // And it is one board rather than two copies of one: Sam edits Maya's note and Maya sees
    // the edit.
    const centre = await noteCentreOnScreen(sam.page, noteId);
    await sam.page.mouse.dblclick(centre.x, centre.y);
    await sam.page.keyboard.press('End');
    await sam.page.keyboard.type(' — Sam was here');
    await sam.page.keyboard.press('Escape');
    await waitForChange('Maya sees Sam’s edit', async () =>
      (await maya.board()).some(
        (note) => note.id === noteId && note.text.includes('Sam was here'),
      ),
    );
    // Sam's own screen agrees; nobody is looking at a stale view.
    const [onMayasScreen, onSamsScreen] = await Promise.all([maya.board(), sam.board()]);
    expect(onMayasScreen.map((note) => note.text).sort()).toEqual(
      onSamsScreen.map((note) => note.text).sort(),
    );

    logLatencyReport('create, share, join (TC-26)');
    expect(sam.errors()).toEqual([]);
    await sam.context.close();
  });

  test('TC-27 a bad link says so, and the page it says it on is a way out', async ({ page }) => {
    // A well-formed address nobody created — two characters swapped in a link, or a board
    // that is gone.
    const unknown = newBoardId();
    await page.goto(`/b/${unknown}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    // The address is what it was: a page that redirected away from a broken link would hide
    // the link that is broken, and the person could not tell anybody what to fix.
    expect(new URL(page.url()).pathname).toBe(`/b/${unknown}`);
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
    // And looking did not create it.
    expect(await checkBoard(page.request, unknown)).toBe(404);

    // The way out that needs nobody else: a board now.
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${BOARD_ID}$`));
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForConnection(page, 'Alex');
    const created = boardIdFromUrl(page.url());
    expect(created).not.toBe(unknown);
    // Fresh and empty — not the board the bad link was aiming at, and not a copy of it.
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);

    // Creating a board makes *its* address a board and not the one that was looked at.
    expect(await checkBoard(page.request, created)).toBe(200);
    expect(await checkBoard(page.request, unknown)).toBe(404);

    // Back is back to the broken link, still broken, showing the same page.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/b/${unknown}`);
    await page.goForward();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    expect(boardIdFromUrl(page.url())).toBe(created);
  });

  test('TC-28 a board that will not answer at first opens when it starts, without a reload', async ({
    page,
    request,
  }) => {
    const boardId = await createBoard(request);
    // The service stops answering the question "is this a board?" — the board itself is
    // untouched, which is what makes this different from a bad link.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${boardId}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
    // It says "retrying" rather than "not found": the board exists, and a page that said
    // otherwise would tell this person their colleagues' board had been deleted.
    await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
    await expect(page.getByTestId('board-viewport')).toHaveCount(0);

    // The service comes back. The page asked on a timer, so the next timer is the board —
    // nobody presses anything, and nobody reloads.
    await page.unroute('**/api/boards/*');
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 20_000 });
    await waitForConnection(page, 'Alex');
    expect(boardIdFromUrl(page.url())).toBe(boardId);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toHaveCount(0);
  });

  test('TC-29 a clipboard that will not take the link says what to press instead', async ({
    page,
  }) => {
    // The clipboard is refused rather than missing: `writeText` rejects, as it does when the
    // document is not focused or the permission is denied.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied by the test')) },
      });
    });
    const boardId = await openFreshBoard(page);

    const link = await shownLink(page);
    expect(link).toBe(`${new URL(page.url()).origin}/b/${boardId}`);
    await page.getByRole('button', { name: 'Copy link' }).click();

    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
    // Never "copied": a confirmation the app did not earn is a person who does not try
    // again and has no link.
    await expect(page.getByText('Link copied')).toHaveCount(0);

    // The fallback does the selecting, so the next Ctrl+C is enough: the field's own
    // selection is the whole link.
    const selected = await page.getByRole('textbox').evaluate((element) => {
      const field = element as HTMLInputElement;
      return { start: field.selectionStart, end: field.selectionEnd, value: field.value };
    });
    expect(selected.value).toBe(link);
    expect(selected.start).toBe(0);
    expect(selected.end).toBe(link.length);
  });

  test('TC-31 a board saved before links existed is still a board', async ({ browser, request }) => {
    // The legacy shape (prd `share.legacy_boards`): real updates written by the same model
    // the app uses, saved at an address, and no creation marker anywhere. No product path
    // can build that, which is what the test hook is for.
    const board = retroBoard();
    const seeded = await request.post(`/__test/boards/${board.boardId}/seed-legacy`, {
      data: { updates: board.updates.map((update) => Buffer.from(update).toString('base64')) },
    });
    expect(seeded.status(), 'the legacy board was not seeded').toBe(200);
    // Content is what makes a board, so the address answers to a check.
    expect(await checkBoard(request, board.boardId)).toBe(200);

    const person = await openParticipant(browser, 'Alex', board.boardId);
    const notes = await person.board();
    expect(notes).toHaveLength(board.notes.length);
    expect(notes.map((note) => note.text).sort()).toEqual(board.notes.map((note) => note.text).sort());
    expect(person.errors()).toEqual([]);

    // And it is a working board rather than a museum piece: the person writes, reloads, and
    // comes back to what they wrote. From the toolbar, because this board is full of the
    // fixture's notes and a double-click on one of them edits it instead of adding another.
    const added = await person.createNoteFromToolbar();
    await person.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForConnection(person.page, 'Alex');
    await expect
      .poll(async () => (await person.board()).some((note) => note.id === added), EVENTUALLY)
      .toBe(true);
    expect(person.errors()).toEqual([]);

    await person.context.close();
  });
});
