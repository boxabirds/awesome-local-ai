/**
 * Story 5 e2e: sharing a board by its link, in a real browser against
 * `wrangler dev`.
 *
 * These are the flows the story is *for*: a board made in one window and opened in
 * another by pasting what the first window copied (TC-26); a link that names a
 * board nobody made (TC-27); a service that cannot answer the question (TC-28); a
 * browser that will not hand over the clipboard (TC-29); and a board that was
 * already there when links were introduced (TC-31).
 *
 * Clipboard permission behaviour is the one thing here that differs between
 * engines, so the copy is measured where the engine allows it and the *fallback*
 * is asserted with a clipboard that is forced to refuse (design: share.share_panel
 * "both paths are forced deterministically").
 */
import { expect, test, type Page } from '@playwright/test';

import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import {
  boardIdFromUrl,
  boardPath,
  boardExists,
  createBoard,
  openFreshBoard,
  seedLegacyBoard,
} from './helpers/share';
import {
  changeVisible,
  createNote,
  openBoard,
  startTyping,
  stopEditing,
  slot,
  type Participant,
} from './helpers/live';
import { noteTexts } from './helpers/notes';

/** What a browser will let a test do with the clipboard, where it lets it do anything. */
const CLIPBOARD_PERMISSIONS = ['clipboard-read', 'clipboard-write'];

/** The origin the suite's `wrangler dev` is served at. */
const originOf = (page: Page): string => new URL(page.url()).origin;

/**
 * Whatever the person could paste now. `null` means this browser would not show
 * us: the panel's own field is then the strongest evidence left, and the fact that
 * the clipboard was unreadable is written down rather than hidden.
 */
async function pastedText(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(async () => await navigator.clipboard.readText());
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.log(`[e2e] clipboard-read is not available here (${why.split('\n')[0]}); asserting the link the panel offered instead`);
    return null;
  }
}

test('TC-26 create a board, copy its link, and the second person is on the same board', async ({
  browser,
}) => {
  // Maya: a board of her own, made the way a person makes one.
  const mayaContext = await browser.newContext({ permissions: CLIPBOARD_PERMISSIONS });
  const maya = await mayaContext.newPage();
  const problems: string[] = [];
  maya.on('pageerror', (pageError) => problems.push(`page error: ${pageError.message}`));

  const started = Date.now();
  await maya.goto('/');
  await expect(maya.getByTestId('home-page')).toBeVisible();
  await maya.getByRole('button', { name: 'New board' }).click();
  await expect(maya.getByTestId('board-app')).toBeVisible();
  const elapsedMs = Date.now() - started;
  const verdict = elapsedMs <= CREATE_BUDGET_MS ? 'within' : 'OVER';
  console.log(
    `[e2e] TC-26 board visible ${elapsedMs}ms after the click (${verdict} the ${CREATE_BUDGET_MS}ms budget)`,
  );

  const boardId = boardIdFromUrl(maya.url());
  expect(boardId).toMatch(BOARD_ID_PATTERN);

  // A note, written by hand: this is the content that has to travel.
  const noteId = await createNote(maya, slot(0, 0));
  await startTyping(maya, noteId);
  await maya.keyboard.insertText('written by Maya');
  await stopEditing(maya);

  // Share, and copy.
  await maya.getByTestId('share-button').click();
  const offered = await maya.getByTestId('share-link').inputValue();
  expect(offered).toBe(`${originOf(maya)}${boardPath(boardId)}`);
  await maya.getByTestId('share-copy').click();
  await expect(maya.getByTestId('share-copy')).toHaveText('Link copied');
  const pasted = await pastedText(maya);
  const link = pasted ?? offered;
  expect(link, 'the link the panel offered and the link on the clipboard must be one link').toBe(
    offered,
  );

  // Sam opens what he was given. Nothing else about his visit is special: no
  // sign-in, no invitation, no second board of his own to be sent to.
  const sam: Participant = await openBoard(browser, boardIdFromUrl(link), 'Sam');
  const boardIdForSam = boardIdFromUrl(sam.page.url());
  expect(boardIdForSam, 'Sam was sent somewhere else').toBe(boardId);
  await expect(sam.page.locator('.sticky-note')).toHaveCount(1);
  await expect.poll(async () => (await noteTexts(sam.page)).join('|')).toBe('written by Maya');

  // And it is one board, not two that look alike: Sam writes, Maya reads.
  await changeVisible(
    'TC-26 Sam’s edit reaches Maya',
    async () => {
      await startTyping(sam.page, noteId, 'end');
      await sam.page.keyboard.insertText(' and edited by Sam');
      await stopEditing(sam.page);
    },
    async () => (await noteTexts(maya)).some((text) => text.endsWith(' and edited by Sam')),
  );
  await expect
    .poll(async () => (await noteTexts(maya)).join('|'))
    .toBe('written by Maya and edited by Sam');

  // Sam editing did not need a second board either: the address never changed.
  expect(boardIdFromUrl(sam.page.url())).toBe(boardId);
  expect(problems, `Maya’s console: ${problems.join('; ')}`).toEqual([]);
  for (const participant of [sam]) expect(participant.problems).toEqual([]);

  await mayaContext.close();
  await sam.context.close();
});

test('TC-27 a link to a board that was never made says so, and offers a board', async ({
  page,
  request,
}) => {
  // A well-formed id that nothing was ever made for: the only difference between
  // this and a real link is that the server has never heard of it.
  const neverMade = newBoardId();
  expect(await boardExists(request, neverMade)).toBe(false);

  await page.goto(boardPath(neverMade));
  await expect(page.getByTestId('not-found')).toBeVisible();
  // Nothing like a board: no document, no toolbar, and no canvas that would have
  // to have come from somewhere.
  await expect(page.getByTestId('board-app')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('not-found-path')).toContainText(boardPath(neverMade));

  // The way out of a wrong link is the way in to a right one.
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-app')).toBeVisible();
  const madeNow = boardIdFromUrl(page.url());
  expect(madeNow).not.toBe(neverMade);
  expect(await boardExists(request, madeNow)).toBe(true);
  // The address that was wrong is still nobody's board: standing at it created
  // nothing, which is what "no storage written" means in a browser.
  expect(await boardExists(request, neverMade)).toBe(false);
  await expect(page.locator('.sticky-note')).toHaveCount(0);
});

test('TC-28 a link that cannot be answered blames the service, and opens when it can be reached', async ({
  page,
  request,
}) => {
  const boardId = await createBoard(request);
  let reachable = false;
  // Every answer about boards is refused, so the page cannot tell whether this
  // board exists — which is a different state from being told it does not.
  await page.route('**/api/boards/*', async (route) =>
    reachable ? route.continue() : route.abort(),
  );

  const started = Date.now();
  await page.goto(boardPath(boardId));
  await expect(page.getByTestId('board-status')).toContainText('Couldn’t reach vidi6. Retrying…');
  // Not "Board not found", and not a board either.
  await expect(page.getByTestId('not-found')).toHaveCount(0);
  await expect(page.getByTestId('board-app')).toHaveCount(0);

  // The service comes back on its own; nobody reloads the page.
  reachable = true;
  await expect(page.getByTestId('board-app')).toBeVisible({ timeout: 30_000 });
  const waitedMs = Date.now() - started;
  console.log(
    `[e2e] TC-28 the board opened ${waitedMs}ms after the page arrived, having asked again on its own (budget ${E2E_EVENTUAL_TIMEOUT_MS}ms for the whole thing)`,
  );
  expect(boardIdFromUrl(page.url()), 'the page never left the link it was given').toBe(boardId);
});

test('TC-29 when the clipboard refuses, the link is already selected and Ctrl+C is enough', async ({
  page,
}) => {
  // A refusal, installed before the page runs: this is what a browser that has
  // revoked clipboard permission does to a page, and the page cannot tell them
  // apart — so it must not need to.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Document is not focused')) },
    });
  });

  const boardId = await openFreshBoard(page);
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-copy').click();

  await expect(page.getByTestId('share-manual')).toHaveText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );
  // The copy button never claims a copy that did not happen.
  await expect(page.getByTestId('share-copy')).toHaveText('Copy link');

  const selection = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="share-link"]');
    return {
      value: field?.value ?? '',
      start: field?.selectionStart ?? -1,
      end: field?.selectionEnd ?? -1,
      focused: document.activeElement === field,
    };
  });
  expect(selection.value).toBe(`${originOf(page)}${boardPath(boardId)}`);
  expect(selection.start).toBe(0);
  expect(selection.end).toBe(selection.value.length);
  expect(selection.focused).toBe(true);
});

test('TC-31 a board that predates links is a board, and its notes are still there', async ({
  page,
  request,
}) => {
  // A board with logged changes and no `created_at`: the shape a board from
  // before this story is in. It is opened by its link like any other.
  const legacy = newBoardId();
  const texts = await seedLegacyBoard(request, legacy, 3);
  expect(await boardExists(request, legacy)).toBe(true);

  await page.goto(boardPath(legacy));
  await expect(page.getByTestId('board-app')).toBeVisible();
  await expect(page.locator('.sticky-note')).toHaveCount(3);
  // The texts, as a set: the screen puts notes down in creation order and breaks
  // ties by id, and three notes written inside one millisecond tie — measured,
  // one run came back as 2, 3, 1. Which note is on top is story 1's fact and is
  // tested there; what this story promises is that all three are here.
  await expect
    .poll(async () => [...(await noteTexts(page))].sort().join('|'))
    .toBe([...texts].sort().join('|'));
  // And it can be worked on: the shared link is a board, not a museum.
  await expect(page.getByTestId('board-toolbar')).toBeVisible();
});
