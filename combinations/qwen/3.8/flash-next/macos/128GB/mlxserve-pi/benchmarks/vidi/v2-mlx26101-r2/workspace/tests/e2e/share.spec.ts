/**
 * A board's link, in real browsers (design `share.pages`, `share.share_panel`: TC-26 to
 * TC-29, TC-31, plus two more that the design's e2e list does not name).
 *
 * Everything here is about an address. A person presses one button, gets an address they can
 * paste into somebody else's window, and that window shows the same board - or, when the
 * address is not one, says so plainly and offers the way back. Those are the promises, and
 * what makes them worth testing rather than admiring is that an address is a string that
 * leaves the building. So the tests below never type an id into a URL bar and hope: the
 * board is made by the server, the link is read out of the clipboard the page itself wrote,
 * and the second person is a second browser context - its own cookies, its own storage, its
 * own WebSocket - which is the only arrangement in this suite where "somebody else opened
 * my link" is a sentence that means what it says.
 *
 * One thing is deliberately not asserted anywhere in this file: that a link is secret. The
 * clipboard is read to check that the *right* link was copied, not to claim anything about
 * who else could get it.
 */

import { expect, type Browser, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import { badge, newBoardUrl } from './helpers/participants.js';
import {
  boardIdOnPage,
  clipboardText,
  createBoardId,
  grantClipboard,
  waitForBoard,
} from './helpers/boards.js';
import {
  createNote,
  docNotes,
  escapeEditing,
  noteText,
  notes,
  typeIntoNote,
  typeIntoOpenEditor,
  waitForNoteCount,
} from './helpers/sticky.js';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config.js';
import { UNREACHABLE_MESSAGE } from '../../src/client/pages/state.js';
import { BASE_URL } from './target.js';

/* ------------------------------------------------------------------ the pages, as seen */

const homePage = (page: Page) => page.getByTestId('home-page');
const newBoardButton = (page: Page) => page.getByTestId('new-board-button');
const homeMessage = (page: Page) => page.getByTestId('home-message');
const notFoundPage = (page: Page) => page.getByTestId('not-found-page');
const notFoundHeading = (page: Page) => page.getByTestId('not-found-heading');
const notFoundText = (page: Page) => page.getByTestId('not-found-text');
const homeLink = (page: Page) => page.getByTestId('home-link');
const boardOpening = (page: Page) => page.getByTestId('board-opening');
const boardOpeningMessage = (page: Page) => page.getByTestId('board-opening-message');
const shareButton = (page: Page) => page.getByTestId('share-button');
const sharePanel = (page: Page) => page.getByTestId('share-panel');
const shareLink = (page: Page) => page.getByTestId('share-link');
const shareNote = (page: Page) => page.getByTestId('share-note');
const copyLinkButton = (page: Page) => page.getByTestId('copy-link-button');
const shareManual = (page: Page) => page.getByTestId('share-manual');

/* ---------------------------------------------------------------------- small helpers */

/** The board a page is on, read out of its address. */
const boardIdOfUrl = (page: Page): string => {
  const match = new URL(page.url()).pathname.match(/^\/b\/([^/]+)$/u);
  if (!match?.[1]) throw new Error(`this page is not on a board: ${page.url()}`);
  return match[1];
};

/** Does the server say this board exists? Asked from the test process, not from a page. */
async function serverSaysBoardExists(page: Page, id: string): Promise<boolean> {
  const response = await page.request.get(`${BASE_URL}/api/boards/${id}`);
  const body = await response.text();
  if (response.status() !== 200) throw new Error(`the server says ${response.status()} about ${id}: ${body}`);
  return true;
}

/** Press "New board" and wait for the board it made, at the standard view. */
async function makeBoard(page: Page): Promise<string> {
  await expect(newBoardButton(page)).toHaveText('New board');
  await newBoardButton(page).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/u);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('zoom-label')).toHaveText('100%');
  await waitForBoard(page);
  return boardIdOfUrl(page);
}

/**
 * The board's own link, obtained the way a person obtains it: open the Share panel, press
 * Copy link, and read the clipboard back from inside the browser.
 *
 * What the panel displays, what the button claims it copied, and what the clipboard actually
 * holds are checked against each other here rather than against an address the test composed
 * itself, because an address the test composed proves nothing about the link the person got.
 */
async function copyLinkFrom(page: Page): Promise<string> {
  await shareButton(page).click();
  await expect(sharePanel(page)).toBeVisible();
  const shown = await shareLink(page).inputValue();
  await copyLinkButton(page).click();
  await expect(copyLinkButton(page)).toContainText('Link copied');
  const copied = await clipboardText(page);
  expect(copied).toBe(shown);
  await page.keyboard.press('Escape');
  await expect(sharePanel(page)).toHaveCount(0);
  return copied;
}

/** A page in a context of its own, with the clipboard readable so a test can check it. */
async function openContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await grantClipboard(context);
  return await context.newPage();
}

/** A page that has reached its room. */
async function expectConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState ?? null), {
      message: `this page never reached its room: ${page.url()}`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('connected');
  await expect(badge(page)).toHaveCount(0);
}

/**
 * Type into the note that is open for editing and wait for the text to arrive on the other
 * side. `typeIntoOpenEditor` asserts the document this page holds; this asserts the document
 * the *other* page holds, which is the difference between "I typed something" and "we are on
 * one board".
 */
async function typeAndWaitForItOverThere(page: Page, text: string, other: Page): Promise<void> {
  await typeIntoOpenEditor(page, text);
  await expect
    .poll(
      async () => (await docNotes(other)).filter((note) => note.text === text).length,
      {
        message: `"${text}" never arrived on ${other.url()}`,
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      },
    )
    .toBe(1);
}

/* ------------------------------------------------------------------------------ TC-26 */

test('TC-26: Maya makes a board, copies its link, and Sam is on it', async ({
  page,
  context,
  browser,
}) => {
  await grantClipboard(context);
  await page.goto('/');

  // The home page is a home page: a name, a line about what it is, one button, and no
  // board behind it waiting to be noticed.
  await expect(homePage(page)).toBeVisible();
  await expect(page.getByTestId('home-tagline')).toHaveText('A shared board for thinking together');
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // One press, and the board is there. How long that took is printed, not asserted: on a
  // shared machine a creation that takes 2.4 s is information, not a broken build
  // (design "Not covered"), and the budget it is compared to is the one the PRD names.
  const pressedAt = Date.now();
  const id = await makeBoard(page);
  const tookMs = Date.now() - pressedAt;
  console.log(
    `[TC-26] New board -> board on screen in ${tookMs}ms ` +
      `(CREATE_BUDGET_MS is ${CREATE_BUDGET_MS}; logged, not asserted)`,
  );

  // The address is the board's: `/b/<22 characters>`, and it is a board the server agrees
  // is there when asked from outside the browser.
  expect(new URL(page.url()).pathname).toBe(`/b/${id}`);
  expect(id).toHaveLength(22);
  expect(await serverSaysBoardExists(page, id)).toBe(true);
  expect(await boardIdOnPage(page)).toBe(id);
  // The tab says which board it is on, which is the small reason a shared board can be told
  // apart from the other three that were shared with you.
  await expect(page).toHaveTitle(`Board ${id} - vidi6`);

  // Maya's board is not empty when she sends it: one note, so that what Sam sees is a board
  // with something on it rather than two copies of nothing.
  await createNote(page);
  await typeIntoNote(page, 'made by Maya');
  await escapeEditing(page);

  const link = await copyLinkFrom(page);
  expect(link).toBe(page.url());

  // Sam. A different browser context: different cookies, different storage, a different
  // WebSocket to the room. All he has from Maya is the string.
  const sam = await openContext(browser);
  try {
    await sam.goto(link);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    await waitForBoard(sam);
    await expect(sam).toHaveURL(link);
    expect(boardIdOfUrl(sam)).toBe(id);
    expect(await boardIdOnPage(sam)).toBe(id);
    await expectConnected(page);
    await expectConnected(sam);

    // Sam sees Maya's note - which is the assertion that says this is the board she made
    // and not a board that happens to be at the same address.
    await waitForNoteCount(sam, 1);
    expect(await noteText(sam, 0)).toBe('made by Maya');

    // And Sam can edit it. Not "Sam is shown something read-only": an edit made here is
    // read back on Maya's page a moment later, which is the whole promise of the link.
    await createNote(sam);
    await typeAndWaitForItOverThere(sam, 'added by Sam', page);
    await escapeEditing(sam);
    await waitForNoteCount(page, 2);
    await expect(notes(page)).toHaveCount(2);
  } finally {
    await sam.context().close();
  }
});

/* ------------------------------------------------------------------------------ TC-27 */

test('TC-27: an address that is not a board says so, and the page is not a dead end', async ({
  page,
  context,
}) => {
  // Twenty-two well-formed characters that were never made: not a malformed id, so this is
  // the server being asked about an address and answering that it does not know it.
  const unknown = newBoardUrl();
  await page.goto(unknown);

  await expect(notFoundPage(page)).toBeVisible();
  await expect(notFoundHeading(page)).toHaveText('Board not found');
  // No board, and no board's title either.
  await expect(page).toHaveTitle('vidi6');
  await expect(notFoundText(page)).toHaveText(
    "Check the link, or ask the person who shared it to send it again.",
  );
  await expect(homeMessage(page)).toHaveText('');
  // There is no board here, and nothing pretending to be one: no viewport, no toolbar, no
  // notes, no "empty board" that a mistyped address quietly became.
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);
  await expect(page.getByTestId('board-toolbar')).toHaveCount(0);
  // A way out, for somebody who arrived here through somebody else's link.
  await expect(homeLink(page)).toHaveAttribute('href', '/');

  // The button on this page makes a board - the story does not end at a dead stop, and the
  // address it lands on is one the server knows.
  await grantClipboard(context);
  const id = await makeBoard(page);
  expect(await serverSaysBoardExists(page, id)).toBe(true);
  expect(await boardIdOnPage(page)).toBe(id);
  await expect(notes(page)).toHaveCount(0);
});

/* ------------------------------------------------------------------------------ TC-28 */

test('TC-28: a service that is not there when the link is opened comes back on its own', async ({
  page,
}) => {
  // A board that exists, and a service that cannot be reached at the moment the link is
  // opened. The outage is made by refusing the request rather than by killing the server,
  // because the thing under test is what the page does about an answer that never comes -
  // and it has to come back from it without anybody reloading.
  const id = await createBoardId(page.request);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);

  // It says what it is doing, which is not "Board not found": the page does not know the
  // board is gone, it knows it could not ask.
  await expect(boardOpeningMessage(page)).toHaveText(UNREACHABLE_MESSAGE);
  await expect(notFoundPage(page)).toHaveCount(0);
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // Service back. Nobody is asked to do anything: the retry the page scheduled does it.
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('board-viewport')).toBeVisible({
    timeout: BOARD_CHECK_RETRY_BASE_MS * 4 + E2E_EVENTUAL_TIMEOUT_MS,
  });
  await waitForBoard(page);
  await expectConnected(page);

  // Still the same address, still the same page: this is a recovery, not a reload.
  expect(boardIdOfUrl(page)).toBe(id);
  await expect(boardOpening(page)).toHaveCount(0);

  // And it is the board: an edit made here is in the document the server holds.
  await createNote(page);
  await typeIntoOpenEditor(page, 'found it in the end');
  await escapeEditing(page);
  await waitForNoteCount(page, 1);
});

/* ------------------------------------------------------------------------------ TC-29 */

test('TC-29: a clipboard that refuses the link leaves the person the link', async ({
  page,
  context,
}) => {
  // The rejection is scripted, because the behaviour it has to produce is not something a
  // browser can be asked to do on request: some browsers refuse, some allow, and the panel
  // has to do the useful thing either way (design "Not covered": the real Safari and Firefox
  // behaviour is not what this test is about).
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await context.clearPermissions();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
  });
  await page.goto('/');
  await makeBoard(page);

  await shareButton(page).click();
  const shown = await shareLink(page).inputValue();
  await copyLinkButton(page).click();

  await expect(shareManual(page)).toHaveText('Press Ctrl+C (Cmd+C on Mac) to copy');
  await expect(copyLinkButton(page)).not.toContainText('Link copied');
  // The link is selected, so the keystroke the message asks for has something to copy, and
  // what is selected is the whole link - not a prefix of it, which would be a link to a
  // board that does not exist.
  const selected = await shareLink(page).evaluate((element: HTMLInputElement) =>
    element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0),
  );
  expect(selected).toBe(shown);
  expect(selected).toBe(page.url());
  expect(selected).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/u);

  // What the link means is said out loud while the person is still deciding about it.
  await expect(shareNote(page)).toHaveText('Anyone with this link can view and edit this board.');
});

test('a browser with no clipboard at all leaves the link selected in the same way', async ({
  page,
}) => {
  // The other shape of "no": not a refusal, an API that is simply not there - which is what
  // a plain http address gets, so this is the state a person on a laptop with an old link is
  // really in.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await makeBoard(page);

  await shareButton(page).click();
  await copyLinkButton(page).click();

  await expect(shareManual(page)).toHaveText('Press Ctrl+C (Cmd+C on Mac) to copy');
  const selected = await shareLink(page).evaluate((element: HTMLInputElement) =>
    element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0),
  );
  expect(selected).toBe(page.url());
});

/* ------------------------------------------------------------------------------ TC-31 */

test('TC-31: a board that was made before links existed still opens at one', async ({
  page,
  context,
}) => {
  // A board with saved content and no `created_at` row, which is what every board in the
  // world was before this story: written as log rows, through the room's own test route, and
  // then read back through the door a person would use - the link.
  const id = newBoardUrl().slice('/b/'.length);
  const texts = ['written before links', 'a second note', 'and a third'];
  const seeded = await page.request.post(`${BASE_URL}/__test/boards/${id}/seed-legacy`, {
    data: { notes: texts.length, texts },
  });
  const body = await seeded.json();
  expect(seeded.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ ok: true, added: texts.length });

  // The server's own answer about this address, before a page has ever looked at it: this is
  // the existence rule saying a board with content is a board, with or without the row that
  // says when it was made.
  expect(await serverSaysBoardExists(page, id)).toBe(true);

  await grantClipboard(context);
  await page.goto(`/b/${id}`);
  await expect(notFoundPage(page)).toHaveCount(0);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForBoard(page);
  await expectConnected(page);

  // The notes it was seeded with are the notes that are there: same count, same texts, in
  // the document and on the screen.
  await waitForNoteCount(page, texts.length);
  const onBoard = (await docNotes(page)).map((note) => note.text).sort();
  expect(onBoard).toEqual([...texts].sort());
  await expect(notes(page)).toHaveCount(texts.length);

  // And it is still a board a person can carry on using: an edit here is accepted.
  await createNote(page);
  await typeIntoOpenEditor(page, 'added after links');
  await escapeEditing(page);
  await waitForNoteCount(page, texts.length + 1);
});

/* ------------------------------------------------- two more that the list does not name */

test('the home page never reopens a board; every press makes a new one', async ({ page }) => {
  await page.goto('/');
  const first = await makeBoard(page);

  // Back to the home page the way a person would: by typing the address.
  await page.goto('/');
  await expect(homePage(page)).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);
  await expect(newBoardButton(page)).toHaveText('New board');

  const second = await makeBoard(page);
  expect(second).not.toBe(first);
  expect(await serverSaysBoardExists(page, first)).toBe(true);
  expect(await serverSaysBoardExists(page, second)).toBe(true);

  // The first board is the board it was. A note put on it shows up at its own address and
  // nowhere near the new one: that is the difference between "a new board" and "the same
  // board, cleared", and it is only visible by looking at both.
  await page.goto(`/b/${first}`);
  await waitForBoard(page);
  await expectConnected(page);
  await createNote(page);
  await typeIntoNote(page, 'the first board');
  await escapeEditing(page);

  await page.goto(`/b/${second}`);
  await waitForBoard(page);
  await expectConnected(page);
  await expect(notes(page)).toHaveCount(0);

  await page.goto(`/b/${first}`);
  await waitForBoard(page);
  await waitForNoteCount(page, 1);
  expect(await noteText(page, 0)).toBe('the first board');
});

test('a link to a board nobody has opened yet opens it in both tabs', async ({ browser }) => {
  // One tab makes a board and stays on it, which is the state a person is actually in when
  // they paste a link into a colleague's chat window: the board exists, it is empty, and its
  // address has never been opened.
  const first = await openContext(browser);
  const second = await openContext(browser);
  try {
    await first.goto('/');
    const id = await makeBoard(first);
    const link = await copyLinkFrom(first);
    await expectConnected(first);

    await second.goto(link);
    // Either the board is still arriving or it is already there; both are honest answers,
    // and what the test cares about is what happens next.
    if (await boardOpening(second).isVisible()) {
      await expect(boardOpeningMessage(second)).toHaveText('Opening board…');
    }
    await expect(second.getByTestId('board-viewport')).toBeVisible();
    await waitForBoard(second);
    expect(boardIdOfUrl(second)).toBe(id);
    await expectConnected(second);

    // The tab that was already there still behaves as a board: it is where the note from the
    // other tab turns up. A first tab that had quietly stopped being a board is the failure
    // this last step is looking for, and nothing earlier in the test would notice it.
    await createNote(second);
    await typeAndWaitForItOverThere(second, 'seen by the tab that was here first', first);
    await escapeEditing(second);
    await waitForNoteCount(first, 1);

    await createNote(first);
    await typeAndWaitForItOverThere(first, 'and back again', second);
    await escapeEditing(first);
    await waitForNoteCount(second, 2);
  } finally {
    await first.context().close();
    await second.context().close();
  }
});
