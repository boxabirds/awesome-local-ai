/**
 * Share story 5, end to end (tasks 5.13, TC-26 to TC-29, TC-31).
 *
 * These are the cases that are only true of a whole service: a button that ends with a real board
 * at a real address, a link a clipboard really holds, a second browser told nothing except what was
 * pasted into it, an address nobody ever made that has to say so, and a server that takes its time
 * about an answer and is then forgiven.
 *
 * Nothing here asserts a duration. TC-26 measures the time from the click to the board being
 * editable and puts it in the log against the 2000 ms budget, because the budget is met comfortably
 * and the place to see that is the run, not a build that passes for it (design §9).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { CREATE_BUDGET_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  NOT_FOUND_HEADING,
  OPENING_BOARD_MESSAGE,
  TAGLINE,
  UNREACHABLE_MESSAGE,
} from '../../src/client/pages/messages';
import {
  COPY_LINK_LABEL,
  LINK_COPIED_MESSAGE,
  MANUAL_COPY_MESSAGE,
  SHARE_LABEL,
} from '../../src/client/share/SharePanel';
import { board, doubleClickCreate, editorLocator, noteText, settled } from './helpers/board';
import { expectSameBoard, openPersonPage, waitForConnected } from './helpers/participants';
import { boardAddress, createBoard, DEFAULT_ORIGIN, seedLegacyBoard } from './helpers/boards';

const homePage = (page: Page): Locator => page.getByTestId('home-page');
const notFoundPage = (page: Page): Locator => page.getByTestId('not-found');
const unreachable = (page: Page): Locator => page.getByTestId('board-unreachable');
const shareButton = (page: Page): Locator => page.getByTestId('share-button');
const sharePanel = (page: Page): Locator => page.getByRole('dialog', { name: SHARE_LABEL });
const shareLinkField = (page: Page): Locator => page.getByTestId('share-link-field');
const copyLink = (page: Page): Locator => page.getByTestId('copy-link');
const shareStatus = (page: Page): Locator => page.getByTestId('share-status');
const newBoardButton = (page: Page): Locator => page.getByTestId('new-board-button');
const notes = (page: Page): Locator => page.locator('.sticky-note');

test('TC-26: a button, a link, and a second person told nothing but the link', async ({
  browser,
}, testInfo) => {
  // Maya's browser is allowed its clipboard, which is the case the PRD asks for: the button really
  // does put the link there. A browser that refuses is TC-29, and is dealt with there.
  const maya = await openPersonPage(browser, 'Maya', ['clipboard-read', 'clipboard-write']);

  await maya.page.goto('/');
  await expect(homePage(maya.page)).toBeVisible();
  await expect(maya.page.getByRole('heading', { name: 'vidi6', level: 1 })).toBeVisible();
  await expect(maya.page.getByText(TAGLINE)).toBeVisible();

  const clicked = Date.now();
  await newBoardButton(maya.page).click();
  // The wait is for the board itself: the promise is that she lands on a board she can use, not
  // that the address changes and something eventually appears.
  await expect(board(maya.page)).toBeVisible();
  await waitForConnected(maya.page);
  const editable = Date.now() - clicked;

  const boardId = boardIdFrom(maya.page.url());
  expect(boardId, 'the address holds a board id the service made').toHaveLength(22);

  // She puts something on it, so that what Sam sees is a board rather than an empty one.
  const noteId = await doubleClickCreate(maya.page, 400, 300);
  await maya.page.keyboard.type('Made by Maya');
  await maya.page.keyboard.press('Escape');
  await expect(editorLocator(maya.page)).toHaveCount(0);

  // The share panel, the copy, and what the clipboard ends up holding.
  await shareButton(maya.page).click();
  await expect(sharePanel(maya.page)).toBeVisible();
  const link = `${DEFAULT_ORIGIN}/b/${boardId}`;
  await expect(shareLinkField(maya.page)).toHaveValue(link);
  await copyLink(maya.page).click();
  // The button says it in its own words, for two seconds, and the confirmation is what a person
  // reads instead of wondering whether anything happened.
  await expect(copyLink(maya.page)).toHaveText(`${LINK_COPIED_MESSAGE} ✓`);

  const pasted = await maya.page.evaluate(() => navigator.clipboard.readText());
  expect(pasted, 'the clipboard does not hold the link').toBe(link);

  // Sam is told nothing except what is pasted into his address bar: no shared context, no storage,
  // no prior knowledge of the board id. He was not even in Maya's browser.
  const sam = await openPersonPage(browser, 'Sam');
  await sam.page.goto(pasted);
  await expect(board(sam.page)).toBeVisible();
  await waitForConnected(sam.page);
  await expect.poll(() => noteText(sam.page, noteId)).toBe('Made by Maya');
  await expectSameBoard([maya, sam], 'the link brought Sam to Maya’s board');

  // And it is his board too: what he types shows up where she is.
  const hisNote = await doubleClickCreate(sam.page, 700, 420);
  await sam.page.keyboard.type('Made by Sam');
  await sam.page.keyboard.press('Escape');
  await expect
    .poll(() => noteText(maya.page, hisNote), 'Sam’s note on Maya’s board')
    .toBe('Made by Sam');

  // FR-4, measured rather than asserted: comfortably met here, and the number belongs in the run.
  testInfo.annotations.push({
    type: 'click-to-board',
    description: `click to editable board: ${editable}ms (budget ${CREATE_BUDGET_MS}ms)`,
  });
  console.info(
    `TC-26 click to editable board: ${editable}ms (budget ${CREATE_BUDGET_MS}ms — ` +
      `${editable <= CREATE_BUDGET_MS ? 'inside' : 'over'})`,
  );
  await maya.context.close();
  await sam.context.close();
});

test('TC-27: an address nobody made says Board not found, and offers a way in', async ({
  page,
}) => {
  const boardId = newBoardId();
  await page.goto(boardAddress(boardId));

  await expect(notFoundPage(page)).toBeVisible();
  await expect(page.getByTestId('not-found-heading')).toHaveText(NOT_FOUND_HEADING);
  await expect(page.getByTestId('not-found-board-id')).toHaveText(boardId);
  // What it is not: a silent failure with an empty canvas, and no offer of anything else.
  await expect(board(page)).toHaveCount(0);
  await expect(notes(page)).toHaveCount(0);
  expect(page.url()).toBe(boardAddress(boardId));

  // The way out: a board of their own, which is empty and is not the address they came in on.
  await Promise.all([page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/), newBoardButton(page).click()]);
  await expect(board(page)).toBeVisible();
  await waitForConnected(page);
  expect(boardIdFrom(page.url())).not.toBe(boardId);
  await expect(notes(page)).toHaveCount(0);

  // And the service agrees: the address they first asked for is still not a board.
  const stillNotFound: number = await page.evaluate(
    (id: string) => fetch(`/api/boards/${id}`).then((response) => response.status),
    boardId,
  );
  expect(stillNotFound).toBe(404);
});

test('TC-28: a server that does not answer is retried, and then forgiven', async ({ page }) => {
  const boardId = await createBoard();
  const link = boardAddress(boardId);

  // Every test id the page ever put on screen, from the first frame onwards. What the page says
  // while it is waiting is a thing that happens for a moment and then stops happening, so it is
  // recorded as it goes rather than looked for afterwards, which is how it comes to be a test of
  // FR-9 rather than a test of how fast this machine is.
  await page.addInitScript(() => {
    const w = window as unknown as { vidi6Saw: string[] };
    w.vidi6Saw = [];
    const seen = new Set<string>();
    const note = (value: string): void => {
      if (value !== '' && !seen.has(value)) {
        seen.add(value);
        w.vidi6Saw.push(value);
      }
    };
    const record = (): void => {
      for (const element of document.querySelectorAll('[data-testid]')) {
        note(element.getAttribute('data-testid') ?? '');
      }
      // And what it said: a live region's words are the part a person reads, and they are on
      // screen for a moment and then never again.
      for (const element of document.querySelectorAll('[role="status"]')) {
        note((element.textContent ?? '').trim());
      }
    };
    new MutationObserver(record).observe(document, { childList: true, subtree: true });
    record();
  });

  // The board exists. The first thing the page asks is switched off, and then put back.
  let blocked = true;
  await page.route('**/api/boards/*', (route) =>
    blocked ? route.abort('failed') : route.continue(),
  );

  await page.goto(link);
  // It said it was opening the board, and then that it could not reach the server — and it never
  // once said the board was not there, which is the sentence a person would act on.
  await expect(unreachable(page)).toBeVisible();
  await expect(unreachable(page)).toContainText(UNREACHABLE_MESSAGE);
  await expect(board(page)).toHaveCount(0);
  await expect(notFoundPage(page)).toHaveCount(0);
  const said: string[] = await page.evaluate(
    () => (window as unknown as { vidi6Saw: string[] }).vidi6Saw,
  );
  expect(said).toContain('board-opening');
  expect(said).toContain(OPENING_BOARD_MESSAGE);
  expect(said).not.toContain('not-found');

  blocked = false;
  // No reload and no help from anybody: the page's own next attempt gets through, in its own time.
  await expect(board(page)).toBeVisible({ timeout: 30_000 });
  await waitForConnected(page);
  expect(page.url(), 'the page never moved, so it never reloaded').toBe(link);
  await expect(notFoundPage(page)).toHaveCount(0);
});

test('TC-29: when the clipboard refuses, the link is there to copy by hand', async ({ page }) => {
  // The one browser without a clipboard, which is the case that used to lose a board: a rejection
  // nothing caught would have left the button lit, the panel open and nothing said.
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied by the browser')) },
    });
  });

  const boardId = await createBoard();
  const link = `${DEFAULT_ORIGIN}/b/${boardId}`;
  const complaints: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') complaints.push(message.text());
  });
  page.on('pageerror', (error) => complaints.push(String(error)));

  await page.goto(boardAddress(boardId));
  await expect(board(page)).toBeVisible();
  await waitForConnected(page);

  await shareButton(page).click();
  await expect(sharePanel(page)).toBeVisible();
  await expect(shareLinkField(page)).toHaveValue(link);

  await copyLink(page).click();
  await expect(shareStatus(page)).toHaveText(MANUAL_COPY_MESSAGE);
  // The button did not become a tick it never earned: it still invites the same click.
  await expect(copyLink(page)).toHaveText(COPY_LINK_LABEL);

  // The selection is the whole link and not a word of it. The test is made on the field's own
  // selection marks rather than the highlighted pixels, because "selected" is what it is.
  const selected = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="share-link-field"]');
    return field === null
      ? null
      : field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  });
  expect(selected).toBe(link);

  // The message stays until the panel is next opened, and nothing was lost: the board is still
  // open, still editable, and the field still holds the link to copy.
  await expect(shareStatus(page)).toHaveText(MANUAL_COPY_MESSAGE);
  await expect(shareLinkField(page)).toHaveValue(link);
  const noteId = await doubleClickCreate(page, 500, 400);
  expect(noteId.length).toBeGreaterThan(0);
  expect(undenied(complaints)).toEqual([]);
});

test('TC-31: a board that predates links is found by the link it never had', async ({ page }) => {
  // There is no way to go and live one of these, so the server is handed one: content written the
  // way a board that had been edited would have written it, and no record of ever having been
  // created — which is every board that was there before this story.
  const boardId = newBoardId();
  const seeded = await seedLegacyBoard(boardId, [
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    { x: 440, y: 0 },
  ]);

  await page.goto(boardAddress(boardId));
  await expect(board(page)).toBeVisible();
  await expect(notFoundPage(page)).toHaveCount(0);
  await waitForConnected(page);
  await expect(notes(page)).toHaveCount(seeded);

  // It is not a museum piece: the board can still be worked on.
  const noteId = await doubleClickCreate(page, 300, 500);
  await page.keyboard.type('A new note');
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(notes(page)).toHaveCount(seeded + 1);
  await expect.poll(() => noteText(page, noteId)).toBe('A new note');
});

/** The board id out of a board address; empty for anything else, which fails the test above. */
function boardIdFrom(url: string): string {
  const match = /\/b\/([A-Za-z0-9_-]+)$/.exec(url);
  return match?.[1] ?? '';
}

/** What a browser complained about, once the rejection this test causes is taken out. */
function undenied(messages: readonly string[]): string[] {
  return messages.filter((message) => !/denied by the browser/i.test(message));
}
