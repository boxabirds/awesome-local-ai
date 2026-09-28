// A board's link, from the button that makes the board to the second browser that
// opens it. What is asserted here is the address itself - that it is the page's own
// address, that the clipboard gets exactly that, that a link which is nobody's board
// is answered as such without a connection, and that a visitor who is told to wait is
// not handed a link or a not-found page.
import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { SHARED_ORIGIN, seedRoom } from './helpers/persistence.ts';
import { ensureBoard } from './helpers/board.ts';
import { createNoteAt, notes, pasteIntoEditor } from './helpers/sticky.ts';
import { buildSizedBoard } from '../fixtures/boards.ts';

const VIEWPORT = '[data-testid="viewport"]';
const SHARE_BUTTON = '[data-testid="share-button"]';
const SHARE_LINK = '[data-testid="share-url-text"]';
const COPY_BUTTON = '[data-testid="copy-link-button"]';
const COPY_MESSAGE = '[data-testid="copy-message"]';
const COPY_TICK = '[data-testid="copy-link-button"][data-copied="true"]';
const CREATE_BUTTON = '[data-testid="create-board"]';
const CREATE_MESSAGE = '[data-testid="create-message"]';
const NOT_FOUND = '[data-testid="not-found-page"]';

const BOARD_URL = /\/b\/[A-Za-z0-9_-]{22}$/;

async function openStartPage(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator(CREATE_BUTTON)).toBeVisible();
}

// The board's address, read out of the open panel.
async function sharedLink(page: Page): Promise<string> {
  await expect(page.locator(SHARE_BUTTON)).toBeVisible();
  await page.locator(SHARE_BUTTON).click();
  const link = page.locator(SHARE_LINK);
  await expect(link).toBeVisible();
  return await link.inputValue();
}

async function createBoardThroughThePage(page: Page): Promise<string> {
  await openStartPage(page);
  await page.locator(CREATE_BUTTON).click();
  await expect(page.locator(VIEWPORT)).toBeVisible();
  expect(page.url()).toMatch(BOARD_URL);
  return page.url();
}

// A note, written the way the board specs write one: make it, put the text in, and
// end the editing state so the page shows what the board holds rather than what the
// editor holds. The count is asserted as a growth, because on a shared board the
// number of notes is not this test's to know.
async function addNote(page: Page, text: string): Promise<void> {
  const notes = page.getByRole('group', { name: 'Sticky note' });
  const before = await notes.count();
  await createNoteAt(page, 380, 240 + before * 220);
  await pasteIntoEditor(page, text);
  await page.keyboard.press('Escape');
  await expect(notes).toHaveCount(before + 1);
}

// What each note holds, read from the note's text element: the group's own text would
// also carry the chrome of a selected note, which is not what the board holds.
async function noteTexts(page: Page): Promise<string[]> {
  return (await page.locator('.sticky-text').allInnerTexts()).map((t) => t.trim());
}

test('TC-26 a board made on the start page is opened by its own address', async ({
  page,
  browser,
}) => {
  const url = await createBoardThroughThePage(page);
  await addNote(page, 'shared board');

  // The panel offers exactly the address the page is at: the link a visitor is
  // given is the address of the board they are looking at.
  expect(await sharedLink(page)).toBe(url);

  // A second browser, given nothing but that link, is at the same board.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(url);
  await expect(visitorPage.locator(VIEWPORT)).toBeVisible();
  await expect(visitorPage).toHaveURL(url);
  await expect.poll(() => noteTexts(visitorPage)).toEqual(['shared board']);

  await visitor.close();
});

test('TC-27 what the clipboard is given is exactly the address of the board', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName !== 'webkit') {
    // WebKit knows neither of these permissions; Chromium can be told to let the
    // test read the clipboard back, which is what the assertion at the end does.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: SHARED_ORIGIN,
    });
  }
  const url = await createBoardThroughThePage(page);

  await page.locator(SHARE_BUTTON).click();
  await page.locator(COPY_BUTTON).click();
  // What the page claims: the button itself says the link is copied, and that claim
  // is only allowed to be made after the clipboard took the text.
  await expect(page.locator(COPY_TICK)).toHaveCount(1);
  await expect(page.locator(COPY_BUTTON)).toHaveText('Link copied');

  if (browserName === 'webkit') {
    // WebKit gives a test no way to read the clipboard back, so the clipboard's own
    // contents are unreadable here; what is provable is that the page copied the
    // address it is standing at, which is the address below.
    await expect(page.locator(SHARE_LINK)).toHaveValue(url);
    test.info().annotations.push({
      type: 'note',
      description: 'WebKit cannot read the clipboard in a test; the copied text itself is unchecked',
    });
    return;
  }

  // Read out of the clipboard itself, and compared with what the page is standing
  // at - not with a string the test built.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(url);
  expect(copied).toMatch(BOARD_URL);
});

test('TC-28 a clipboard that will not take the link still leaves the link', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Document is not focused')) },
    });
  });
  const url = await createBoardThroughThePage(page);

  await page.locator(SHARE_BUTTON).click();
  await page.locator(COPY_BUTTON).click();
  await expect(page.locator(COPY_MESSAGE)).toHaveText('Press Ctrl+C (Cmd+C on Mac) to copy');
  // Never a claim that the copy happened.
  await expect(page.locator(COPY_TICK)).toHaveCount(0);

  // The address is still there, still selectable, and it is the board's own: the
  // visitor can take it the old-fashioned way, which is the only door to a board.
  const link = page.locator(SHARE_LINK);
  await expect(link).toHaveValue(url);
  await expect(link).toBeEnabled();
  // The text is put in the visitor's hands: focused and wholly selected, which is
  // what makes the keystroke in the sentence enough.
  const selection = await link.evaluate((el) => {
    const input = el as HTMLInputElement;
    return { start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input };
  });
  expect(selection).toEqual({ start: 0, end: url.length, focused: true });
});

test('TC-29 a visitor who has made too many boards is told to wait, and is given neither a link nor a not-found page', async ({
  page,
}) => {
  // The limiter counts a visitor, so this test uses a visitor of its own: the
  // address is attached to the page's own request as well, so what the page is told
  // is what the exhausted visitor is told.
  const visitor = `203.0.113.${100 + Math.floor(Math.random() * 155)}`;
  // The request the page makes is sent on with that address attached, by way of a
  // fetch the test performs and hands back: the page cannot be told to send an
  // address of its own, and the limiter counts the address the request arrives with.
  await page.route('**/api/boards', async (route) => {
    const response = await route.fetch({
      headers: { ...route.request().headers(), 'CF-Connecting-IP': visitor },
    });
    await route.fulfill({ response });
  });

  // Ten boards is this visitor's share of the minute.
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${SHARED_ORIGIN}/api/boards`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': visitor },
    });
    expect(res.status).toBe(201);
  }

  await openStartPage(page);
  await page.locator(CREATE_BUTTON).click();

  // Told to wait, in words, on the page they were already on.
  await expect(page.locator(CREATE_MESSAGE)).toBeVisible();
  await expect(page.locator(CREATE_MESSAGE)).toContainText(/too quickly/i);
  // No board, no board address, and not the not-found page either.
  await expect(page.locator(VIEWPORT)).toHaveCount(0);
  expect(page.url()).not.toMatch(/\/b\//);
  await expect(page.locator(NOT_FOUND)).toHaveCount(0);
  // The button is a button again: this answer arrived, and a later press is a new
  // question.
  await expect(page.locator(CREATE_BUTTON)).toBeEnabled();
});

test('TC-30 a link that is nobody’s board says so, without a connection, and leaves the way back open', async ({
  page,
}) => {
  // A code shaped like a real one, never created.
  const code = newBoardId();

  await openStartPage(page);
  await page.goto(`/b/${code}`);

  await expect(page.locator(NOT_FOUND)).toBeVisible();
  await expect(page.locator(VIEWPORT)).toHaveCount(0);
  await expect(page.locator('[data-testid="board-checking"]')).toHaveCount(0);
  // Nothing joined this address: the page that says a link is nobody's board does
  // not join it.
  expect(await page.evaluate(() => (window as unknown as { __vidi6?: unknown }).__vidi6)).toBeUndefined();
  // Exactly one way onward, and it is the start page.
  await expect(page.locator('[data-testid="home-link"]')).toHaveCount(1);

  // The back button is the visitor's way back to where they came from.
  await page.goBack();
  await expect(page.locator(CREATE_BUTTON)).toBeVisible();

  // And the server agrees: the link is checked as absent, not created by being
  // looked at. A page that said "not found" and a storage write that made the board
  // would be the same page contradicting itself a minute later.
  const check = await fetch(`${SHARED_ORIGIN}/api/boards/${code}`);
  expect(check.status).toBe(404);

  // The page's one way forward works: a board of this visitor's own, at its own
  // address, which is not the address they came in on.
  await page.goto(`/b/${code}`);
  await page.locator(CREATE_BUTTON).click();
  await expect(page.locator(VIEWPORT)).toBeVisible();
  expect(page.url()).toMatch(BOARD_URL);
  expect(page.url()).not.toContain(code);
  await expect(page.locator(NOT_FOUND)).toHaveCount(0);

  // A link whose shape is not a link is answered the same way, and never asked about.
  await page.goto('/b/not-a-board-code');
  await expect(page.locator(NOT_FOUND)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __vidi6?: unknown }).__vidi6)).toBeUndefined();
});

test('TC-32 a board that was already in use before links were a thing is still a board at its address', async ({
  page,
}) => {
  // Written the way a board was written before this story: content in the log, no
  // record of a creation. The address is one nobody was ever handed.
  const code = newBoardId();
  const board = buildSizedBoard(2);
  const seeded = await seedRoom(code, board.update);
  expect(seeded.state).toBe('ready');
  expect(seeded.logRows + seeded.chunks).toBeGreaterThan(0);

  // The server's own answer about the link: a board, because a board's content is
  // what makes it a board.
  const check = await fetch(`${SHARED_ORIGIN}/api/boards/${code}`);
  expect(check.status).toBe(200);

  // And the page a visitor gets when they arrive at it: the board, with what is on
  // it, and not a page saying the link is nobody's board.
  await page.goto(`/b/${code}`);
  await expect(page.locator(VIEWPORT)).toBeVisible();
  await expect(page.locator(NOT_FOUND)).toHaveCount(0);
  await expect(notes(page)).toHaveCount(2);
});

test('TC-31 one link, two browsers, and the board is the same board afterwards', async ({
  page,
  browser,
}) => {
  const boardId = newBoardId();
  await ensureBoard(boardId);
  const url = `${SHARED_ORIGIN}/b/${boardId}`;

  await page.goto(url);
  await expect(page.locator(VIEWPORT)).toBeVisible();
  await addNote(page, 'first thought');

  const visitor = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(url);
  await expect.poll(() => noteTexts(visitorPage)).toEqual(['first thought']);

  // The second browser adds to the same board, and the first sees it.
  await addNote(visitorPage, 'second thought');
  await expect
    .poll(() => noteTexts(page))
    .toEqual(expect.arrayContaining(['first thought', 'second thought']));

  // The link is still the same link after all that, and it still opens this board.
  expect(await sharedLink(page)).toBe(url);
  await visitorPage.reload();
  await expect(visitorPage.locator(VIEWPORT)).toBeVisible();
  await expect
    .poll(() => noteTexts(visitorPage))
    .toEqual(expect.arrayContaining(['first thought', 'second thought']));

  await visitor.close();
});
