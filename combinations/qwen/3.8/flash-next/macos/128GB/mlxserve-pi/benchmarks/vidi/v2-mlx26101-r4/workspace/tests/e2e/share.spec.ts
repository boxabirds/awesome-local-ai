/**
 * Story 5, in real browsers: a board's link is enough to get somebody onto it.
 *
 * Nothing here is stubbed except where the test would otherwise be measuring a browser's clipboard
 * implementation rather than the board's. Two contexts that share nothing but an address, the app
 * built as it is shipped, the room and its storage on the real runtime — because the promise under
 * test is precisely that a link is a complete description of how to get in. If any part of it were
 * faked, the test would be proving something weaker than "send this to somebody".
 *
 * Two things are deliberately *not* asserted as timings. Making a board is measured and printed
 * against CREATE_BUDGET_MS rather than failed on it: this machine is running the browser, the model
 * and the room at once, and a board that took 1.4 s to appear on a loaded machine is not a board that
 * is broken. A board that never appears is caught by the functional assertion underneath it, which is
 * the one that says whether anybody can use the thing.
 */
import { expect, test, type Page } from '@playwright/test';

import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';
import { appOrigin, board, createBoardAt } from './helpers/board';
import { expectEventually } from './helpers/participants';
import { createNote, noteCount, pasteIntoEditor, startEditingNote, stickies } from './helpers/sticky';

/** Where the notes these tests make go. Screen points, as everywhere in the e2e suite. */
const NOTE_AT = { x: 420, y: 300 };

/** The board id in a board address, or '' when the address is not one. */
function idOf(address: string): string {
  const path = new URL(address).pathname;
  return path.startsWith('/b/') ? path.slice('/b/'.length) : '';
}

/** What the suite's contexts are set to, used when a page cannot say. */
const VIEWPORT = { width: 1280, height: 800 };

/**
 * The link field has to sit inside the panel that holds it, and the panel inside the window.
 *
 * A board's link is always longer than the space a panel can offer — origin, `/b/`, and a
 * 22-character id — and a field asked to be as wide as its contents is a field that walks out of the
 * panel and off the edge of the screen: a grid track takes its minimum from the items in it, and a
 * text field's minimum is the width its value wants. Nothing else in this suite asks where the thing
 * is drawn: jsdom performs no layout at all, so a component test cannot see a box, and until a real
 * browser measured this the bug was invisible to every other test in the repository.
 */
async function expectFieldInsidePanel(page: Page): Promise<void> {
  const panel = await page.getByTestId('share-panel').boundingBox();
  const field = await page.getByTestId('share-link').boundingBox();
  expect(panel, 'the share panel has a box').not.toBeNull();
  expect(field, 'the link field has a box').not.toBeNull();
  if (panel === null || field === null) return;
  const screen = page.viewportSize() ?? VIEWPORT;
  expect(field.x, 'the link field starts inside the panel').toBeGreaterThanOrEqual(panel.x);
  expect(field.x + field.width, 'the link field ends inside the panel').toBeLessThanOrEqual(
    panel.x + panel.width,
  );
  expect(panel.x + panel.width, 'the panel is on the screen').toBeLessThanOrEqual(screen.width);
  expect(panel.width, 'the panel is the width the panel was given, not the width of its link').toBeLessThanOrEqual(
    400,
  );
}

/**
 * Gives this page a clipboard it can use, and says which one it got.
 *
 * Chromium is granted the real thing, because there the whole chain can be exercised: the page
 * writes, the browser accepts, and a second read returns what was written. The other engines have no
 * permission by those names to grant, and Playwright refuses a name it does not know — so there the
 * clipboard is told to succeed instead, which leaves this file testing the board's use of a clipboard
 * rather than the engine's. That is the split the design asks for: the real clipboard in Chromium,
 * and the refusal forced in TC-29 on every engine.
 */
async function setUpClipboard(page: Page): Promise<'real' | 'stubbed'> {
  const engine = page.context().browser()?.browserType().name() ?? 'unknown';
  if (engine === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    return 'real';
  }
  await page.addInitScript(() => {
    const written: string[] = [];
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          written.push(text);
          return Promise.resolve();
        },
        readText: (): Promise<string> => Promise.resolve(written[written.length - 1] ?? ''),
      },
    });
  });
  return 'stubbed';
}

/** The text a person would be able to paste, however it got there. */
function clipboardText(page: Page): Promise<string> {
  return page.evaluate(async () => navigator.clipboard.readText());
}

/** Nothing that smells like an account, anywhere on this page. */
async function expectNoSignIn(page: Page): Promise<void> {
  await expect(page.getByText(/sign in|sign up|log in|log out|create an account|your account/i)).toHaveCount(
    0,
  );
}

/** The words in the notes of a board, in the order they were made. */
function textsOf(page: Page): Promise<readonly string[]> {
  return stickies(page).then((notes) => notes.map((note) => note.text));
}

test('a board made on the home page, shared by its link, and joined by somebody else (TC-26)', async ({
  page,
  browser,
}) => {
  const clipboard = await setUpClipboard(page);
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await expectNoSignIn(page);

  // Click to board. Printed, not asserted: see the note at the top of this file.
  const startedAt = Date.now();
  await page.getByTestId('new-board').click();
  await expect(board(page)).toBeVisible();
  const openedInMs = Date.now() - startedAt;
  console.log(
    `  [create] home page to a board you can work on: ${openedInMs} ms ` +
      `(budget ${CREATE_BUDGET_MS} ms, logged and not asserted)`,
  );

  // The address is a board address, the id in it is a board id, and the board is empty: a new board
  // arrives empty, not as somebody else's.
  const address = page.url();
  const boardId = idOf(address);
  expect(new URL(address).pathname).toBe(`/b/${boardId}`);
  expect(isValidBoardId(boardId)).toBe(true);
  expect(await noteCount(page)).toBe(0);

  // Maya puts something on the board, because a link to an empty board and a link to a broken board
  // look the same until somebody else arrives.
  const noteId = await createNote(page, NOTE_AT, 'Bring your own ideas');

  // The link she is offered is the address in the bar, in full.
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  // The field holding the link is inside the panel holding the field — see the helper.
  await expectFieldInsidePanel(page);
  const offered = await page.getByTestId('share-link').inputValue();
  expect(offered).toBe(address);
  await expect(page.getByTestId('share-note')).toContainText(
    'Anyone with this link can view and edit this board.',
  );

  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toContainText('Link copied');
  const copied = await clipboardText(page);
  console.log(`  [clipboard] the link reached the clipboard through the ${clipboard} clipboard`);
  expect(copied).toBe(address);

  // The green word goes away on its own, and the panel stays open with its link: a panel that shut
  // itself after copying would take the link away from the person who is about to paste it.
  await expect(page.getByTestId('share-copy')).not.toContainText('Link copied', {
    timeout: LINK_COPIED_MS + 10_000,
  });
  await expect(page.getByTestId('share-link')).toHaveValue(address);

  // Sam has never been to this app before, has no account, and has one string of text.
  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  const samErrors: string[] = [];
  sam.on('pageerror', (error) => samErrors.push(String(error)));
  await sam.goto(copied);
  await expect(board(sam)).toBeVisible();
  await expect
    .poll(() => sam.evaluate(() => typeof window.__vidi6 === 'object' && window.__vidi6 !== null), {
      timeout: 30_000,
      message: 'the page Sam landed on is not the app built for tests',
    })
    .toBe(true);
  await expect
    .poll(() => sam.evaluate(() => window.__vidi6?.connectionState), {
      timeout: 30_000,
      message: 'Sam never got onto the board whose link she was given',
    })
    .toBe('connected');

  // Her board is his board, and it holds what she put there.
  await expectEventually('Sam sees Maya’s note', () => textsOf(sam), {
    since: Date.now(),
    timeoutMs: 30_000,
  }).toEqual(['Bring your own ideas']);
  const seenBySam = await stickies(sam);
  expect(seenBySam[0]?.id).toBe(noteId);

  // And he is not a viewer. He edits the note she made, on a board he had no relation to at all until
  // he pasted that link.
  const editedAt = Date.now();
  await startEditingNote(sam, 0);
  await pasteIntoEditor(sam, 'Bring your own ideas (and Sam brought one)');
  await expectEventually('Maya sees Sam’s edit', () => textsOf(page), {
    since: editedAt,
    timeoutMs: 30_000,
  }).toEqual(['Bring your own ideas (and Sam brought one)']);
  expect(await noteCount(sam)).toBe(1);

  // Neither of them was ever asked who they are.
  await expectNoSignIn(page);
  await expectNoSignIn(sam);
  expect(samErrors, samErrors.join('\n')).toEqual([]);

  await samContext.close();
});

test('a link that was never a board says so, and offers a board of its own (TC-27)', async ({
  page,
  request,
}) => {
  const neverMade = newBoardId();
  await page.goto(`/b/${neverMade}`);

  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await expect(page.getByText('Board not found')).toBeVisible();
  await expect(
    page.getByText('Check the link, or ask the person who shared it to send it again.'),
  ).toBeVisible();
  // No board, and no board-shaped hole where one should have been: this page has nothing to draw.
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);
  await expect(page.getByTestId('share-button')).toHaveCount(0);

  // The room behind that link was reached — it has to be, to answer the question — and it made
  // nothing. What an ordinary HTTP client can see of that address is the answer story 3 established:
  // it only ever speaks over a WebSocket. The 404 for a board nobody made is what it gives *to an
  // upgrade*, and no HTTP client is allowed to send an Upgrade header, so that half of the claim — a
  // socket to a link nobody made is turned away and leaves nothing behind in storage — is TC-09's,
  // tested where the storage itself can be looked at.
  expect((await request.get(`/api/rooms/${neverMade}`)).status()).toBe(426);
  expect((await request.get(`/api/boards/${neverMade}`)).status()).toBe(404);

  // The page's one offer, taken: a board, which is empty, at an address that is not the one that
  // failed. This address can never be anybody's board.
  await page.getByTestId('new-board').click();
  await expect(board(page)).toBeVisible();
  const nowAt = idOf(page.url());
  expect(isValidBoardId(nowAt)).toBe(true);
  expect(nowAt).not.toBe(neverMade);
  expect(await noteCount(page)).toBe(0);
});

test('a service that will not answer is waited out, and the board opens without a reload (TC-28)', async ({
  page,
}) => {
  // A board that exists, made before the outage: what is under test is opening its link while the
  // service cannot be reached, not a board that was never there.
  await page.goto('/');
  const boardId = await createBoardAt(await appOrigin(page));

  const pattern = '**/api/boards/*';
  let unreachable = true;
  await page.route(pattern, (route) => (unreachable ? route.abort() : route.continue()));

  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-unreachable-message')).toHaveText(
    "Couldn't reach vidi6. Retrying…",
  );
  // What is *not* said matters more here than what is. Nothing has told anybody this board is missing,
  // and the service never got the chance to claim it was.
  await expect(page.getByTestId('not-found-page')).toHaveCount(0);
  await expect(page.getByText('Board not found')).toHaveCount(0);
  await expect(board(page)).toHaveCount(0);

  // The service starts answering. Nobody reloads, presses a button, or goes back to the home page:
  // the page asked again because it had said it would. To be sure nothing was reloaded, a mark is
  // left in this page's own JavaScript first — a reload wipes it, and it is found here afterwards,
  // in the same page that said "Retrying…".
  const mark = 'still-the-same-page';
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__tc28 = value;
  }, mark);
  unreachable = false;
  await expect(board(page)).toBeVisible({ timeout: 30_000 });
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__tc28),
    'the board appeared without the page being reloaded',
  ).toBe(mark);
  await expect(page.getByTestId('board-unreachable')).toHaveCount(0);
  await page.unroute(pattern);

  // And it is a board he can use, not a page that merely stopped complaining.
  await createNote(page, NOTE_AT, 'Arrived after the wait');
  expect(await noteCount(page)).toBe(1);
});

test('a clipboard that refuses the link leaves the person a way to finish the job (TC-29)', async ({
  page,
}) => {
  await page.goto('/');
  const boardId = await createBoardAt(await appOrigin(page));

  // A clipboard that says no, which is what a browser does with a page that has not earned it. Forced
  // rather than hunted for, so the fallback is checked on every engine in the run instead of on
  // whichever one happens to be rude today.
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (): Promise<void> => Promise.reject(new Error('NotAllowedError: write not allowed')),
        readText: (): Promise<string> => Promise.reject(new Error('NotAllowedError: read not allowed')),
      },
    });
  });
  await page.goto(`/b/${boardId}`);

  await page.getByTestId('share-button').click();
  const link = await page.getByTestId('share-link').inputValue();
  expect(link).toBe(page.url());

  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-manual')).toHaveText('Press Ctrl+C (Cmd+C on Mac) to copy');

  // The message and the field are one instruction: the whole link is selected, so the keys it names
  // finish the job. A message over an unselected field would be a note about a failure rather than a
  // way out of one.
  const selected = await page.getByTestId('share-link').evaluate((element) => {
    const field = element as HTMLInputElement;
    return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  });
  expect(selected).toBe(link);

  // And the panel does not claim a copy that did not happen.
  await expect(page.getByTestId('share-copy')).toHaveText('Copy link');
  await expect(page.getByText('Link copied')).toHaveCount(0);
});

test('a board that has notes in it opens, whatever made those notes (TC-31)', async ({ page }) => {
  // A board from before boards were made by asking: notes in its log and no created row. The room's
  // own fixture writes them the way a board fills up — one row per note, into the same tables.
  const boardId = newBoardId();
  await page.goto('/');
  const origin = await appOrigin(page);

  const seededResponse = await fetch(`${origin}/__test/boards/${boardId}/seed?notes=4`, { method: 'POST' });
  const seededBody = await seededResponse.text();
  expect(seededResponse.ok, seededBody).toBe(true);
  expect((JSON.parse(seededBody) as { seeded: number }).seeded).toBe(4);
  const statsResponse = await fetch(`${origin}/__test/boards/${boardId}/stats`);
  const stats = (await statsResponse.json()) as { updates: number };
  expect(stats.updates).toBe(4);

  await page.goto(`/b/${boardId}`);
  await expect(board(page)).toBeVisible();
  // The sentence this story must never say about a board that has notes in it.
  await expect(page.getByTestId('not-found-page')).toHaveCount(0);
  await expect(page.getByText('Board not found')).toHaveCount(0);

  await expectEventually('the seeded notes are on the board', () => noteCount(page), {
    timeoutMs: 30_000,
  }).toBe(4);

  // And it is a board, not a museum piece: this page can write to it, and the room takes the writing.
  await createNote(page, NOTE_AT, 'A board that was already here');
  await expectEventually('a new note lands on the legacy board', () => noteCount(page)).toBe(5);
  await expect(page.getByTestId('share-button')).toBeVisible();
});
