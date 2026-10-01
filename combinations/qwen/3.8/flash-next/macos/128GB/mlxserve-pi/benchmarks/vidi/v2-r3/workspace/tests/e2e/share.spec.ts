// Story 5 e2e: the link a board is shared by.
//
// These drive the whole path a person takes: Home → New board → a board at its
// own address → Share → a link → another person opens that link and is on the
// same board, able to edit. The board id is the one the server made, never a
// test's own guess.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { boardPath } from '../../src/shared/routes';
import {
  newUnusedBoard,
  newBoard,
  joinBoard,
  leaveAll,
  expectSameBoard,
  expectNoProblems,
  watchNotes,
  expectChangeSeen,
  noteKeyOf,
  type Person,
} from './helpers/participants';
import { gotoBoard, settle } from './helpers/board';
import { createNoteAt, noteText, noteIds } from './helpers/stickies';

const CENTRE = { x: 480, y: 360 };

const shareButton = (page: Page): Locator => page.getByRole('button', { name: 'Share', exact: true });
const copyButton = (page: Page): Locator => page.getByRole('button', { name: 'Copy link' });
const shareLinkField = (page: Page): Locator => page.getByRole('textbox', { name: 'Board link' });
const linkCopied = (page: Page): Locator => page.getByText(/Link copied/);
const manualCopy = (page: Page): Locator => page.getByText(/Press Ctrl\+C/);
const zoomLabel = (page: Page): Locator => page.locator('[data-testid="zoom-label"]');

/** A Person view of a page this test already holds (for the same-board check). */
function personOf(page: Page, name: string): Person {
  return { name, context: page.context(), page, problems: [], expectingOutage: false };
}

/** Open the Share panel and read the link it shows. */
async function shareLinkOf(page: Page): Promise<string> {
  await shareButton(page).click();
  const link = shareLinkField(page);
  await expect(link).toBeVisible();
  return link.inputValue();
}

/** The board id a `/b/<id>` URL carries. */
function boardIdFrom(url: string): string {
  return new URL(url).pathname.split('/').pop()!;
}

test('TC-26: Share shows a working link, and opening it is opening that board', async ({ browser, context, page }, testInfo) => {
  // A board made through the app, with a note on it.
  await gotoBoard(page);
  const noteId = await createNoteAt(page, CENTRE, 'shared note');
  const boardUrl = page.url();

  // The link the Share panel shows is this board's own address.
  const link = await shareLinkOf(page);
  expect(link).toBe(boardUrl);

  // Where the browser lets us, grant clipboard access so the copy goes through
  // the clipboard API (the confirmation and the manual-copy fallback are both
  // covered against the clipboard API in the component tests; here what matters
  // is that the link we are shown is the working one).
  if (testInfo.project.name !== 'webkit') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  }
  await copyButton(page).click();
  // Either the clipboard write confirmed, or the manual-copy fallback took over;
  // both are the Copy control working, and the link it handed over is the next step.
  await expect(linkCopied(page).or(manualCopy(page))).toBeVisible();

  // A second person opens that link and is on the same board.
  const other = await joinBoard(browser, 'Other', boardIdFrom(link));
  await expectSameBoard([personOf(page, 'You'), other], 'board opened by link');
  await expect.poll(() => noteText(other.page, noteId)).toBe('shared note');

  // Editable: they make a change and it takes.
  await createNoteAt(other.page, { x: 300, y: 300 }, 'from the link');
  await expect.poll(() => noteIds(page).then((n) => n.length), { timeout: 10_000 }).toBe(2);

  await expectNoProblems([other]);
  await leaveAll([other]);
});

test('TC-27: two people opening the same link get the same board and both can edit', async ({ browser, request }) => {
  const board = await newBoard(request);
  const alex = await joinBoard(browser, 'Alex', board);
  const sam = await joinBoard(browser, 'Sam', board);
  await watchNotes(alex.page);
  await watchNotes(sam.page);

  // Alex makes a note; Sam sees it arrive.
  let sent = Date.now();
  const id = await createNoteAt(alex.page, CENTRE, 'kickoff');
  await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'Alex’s note for Sam');

  // Sam edits; Alex sees it. The link carried no owner: both can edit.
  sent = Date.now();
  const samId = await createNoteAt(sam.page, { x: 300, y: 500 }, 'sam was here');
  await expectChangeSeen(alex, samId, await noteKeyOf(sam.page, samId), sent, 'Sam’s note for Alex');

  await expectSameBoard([alex, sam], 'both people on the shared link');
  await expectNoProblems([alex, sam]);
  await leaveAll([alex, sam]);
});

test('TC-28: Home creates a board at a real id and two people see the same notes', async ({ browser, page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'vidi6' })).toBeVisible();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  const boardUrl = page.url();
  const noteId = await createNoteAt(page, CENTRE, 'first note');
  await settle(page);

  // Another person opens the exact address this board is at.
  const other = await joinBoard(browser, 'Other', boardIdFrom(boardUrl));
  await expectSameBoard([personOf(page, 'You'), other], 'two people on the new board');
  await expect.poll(() => noteText(other.page, noteId)).toBe('first note');

  // The other person can edit — no prompt, no read-only, no waiting.
  await createNoteAt(other.page, { x: 250, y: 250 }, 'second note');
  await expect.poll(() => noteIds(page).then((n) => n.length), { timeout: 10_000 }).toBe(2);

  await expectNoProblems([other]);
  await leaveAll([other]);
});

test('TC-29: a link that is not a board says so, and does not open an empty board', async ({ browser, page }) => {
  // A well-formed id the service has never heard of.
  const missing = newUnusedBoard();
  await page.goto(boardPath(missing));
  await expect(page.getByRole('heading', { level: 1, name: 'Board not found' })).toBeVisible();
  // Not a board: there is no board UI to work in.
  await expect(page.getByRole('button', { name: 'Sticky note', exact: true })).toHaveCount(0);

  // The New board button on that page creates a real board and goes to it.
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(zoomLabel(page)).toHaveText('100%', { timeout: 20_000 });
  const madeId = boardIdFrom(page.url());
  expect(madeId).not.toBe(missing);

  // The mistyped address still says not found on a second visit, in a new context.
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto(boardPath(missing));
  await expect(op.getByRole('heading', { level: 1, name: 'Board not found' })).toBeVisible();

  // ...and the board that was created opens for that second visitor.
  await op.goto(boardPath(madeId));
  await expect(zoomLabel(op)).toHaveText('100%', { timeout: 20_000 });

  await other.close();
});

test('TC-31: the share link is same-origin and the page asks for no referrer', async ({ page }) => {
  // The document asks for no referrer, so opening a shared link does not tell
  // the origin about the page that referred it.
  await page.goto('/');
  const referrerMeta = await page.evaluate(
    () => document.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? null,
  );
  expect(referrerMeta).toBe('no-referrer');

  // The link is to this same origin (not a third-party shortener or service),
  // and points at exactly this board's address.
  await gotoBoard(page);
  const link = await shareLinkOf(page);
  const here = new URL(page.url());
  const there = new URL(link);
  expect(there.origin).toBe(here.origin);
  expect(there.pathname).toBe(here.pathname);
});
