// Story 5: "Share a board with others using a link."
//
// These are the tests that prove a link is the whole of what sharing means here: one
// click makes a board, the panel hands its address to another person, and that person
// lands on the *same* board — not a copy of it, not a blank board, and not a board of
// their own. Everything runs against the real Worker, the real Durable Object storage
// and real browser contexts with their own storage, because the thing under test is what
// crosses from one browser to another: nothing but the link.
//
// TC-26 uses Chromium's real clipboard (the permissions are granted for this run); the
// clipboard-refused path is forced in TC-29 with an init script, so neither test depends
// on what a particular engine decides about permissions on a particular day.
import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS } from '../../src/shared/config';
import { retroBoard25 } from '../fixtures/boards';
import { boardPath, createBoard, gotoBoard } from './helpers/board';
import {
  createByToolbar,
  editorBox,
  endEditing,
  noteTestId,
  noteTextContent,
  stickyIds,
} from './helpers/sticky';

/** Every request the page makes to the board service (not the room socket). */
function isBoardApi(url: URL): boolean {
  return url.pathname.startsWith('/api/boards');
}

test('TC-26 create, share, join: the link one person copies is the board the other opens', async ({
  browser,
  page,
}) => {
  // The real clipboard, for the engine this run is configured to grant it (design:
  // Chromium). The refused path is TC-29, and the component suite forces both.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  // Maya: one click on the home page, and the board she is looking at is the board the
  // address bar now names.
  await page.goto('/');
  const started = Date.now();
  await page.getByTestId('new-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const clickToBoardMs = Date.now() - started;
  // Logged rather than asserted: on a shared machine the click-to-board time includes
  // the browser's own start-up, so it says nothing about the one-RPC-plus-one-write
  // create. It is printed against the product budget so a regression is visible.
  console.log(
    `[TC-26] click to board: ${clickToBoardMs}ms (CREATE_BUDGET_MS=${CREATE_BUDGET_MS})`,
  );

  const noteId = await createByToolbar(page);
  await page.keyboard.type('a win to celebrate', { delay: 15 });
  await endEditing(page);

  // She opens the panel: it shows the address of the board she is on, and that is what
  // lands on the clipboard.
  await page.getByTestId('share-open').click();
  const link = await page.inputValue('[data-testid="share-link"]');
  expect(link).toBe(page.url());
  expect(new URL(link).pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toContainText('Link copied');
  const copied = await page.evaluate(async () => navigator.clipboard.readText());
  expect(copied).toBe(link);

  // Sam: a browser that has never seen this board, was never told its id, and holds
  // nothing but the text that came off the clipboard.
  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  await sam.goto(copied);
  await expect(sam.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(() => stickyIds(sam), { timeout: 15_000 })
    .toContain(noteId);
  expect(await noteTextContent(sam, noteId)).toBe('a win to celebrate');

  // And it is one board, not two boards that look alike: Sam edits the note, and Maya's
  // screen changes.
  await sam.getByTestId(noteTestId(noteId)).dblclick();
  await expect(editorBox(sam)).toBeVisible();
  await sam.keyboard.type(' — and Sam was here', { delay: 15 });
  await endEditing(sam);
  await expect
    .poll(() => noteTextContent(page, noteId), { timeout: 15_000 })
    .toBe('a win to celebrate — and Sam was here');

  await samContext.close();
});

test('TC-27 a link to a board that was never made is recovered from, not guessed at', async ({
  page,
  request,
}) => {
  // An address of the right shape that nothing ever created: a made-up link, which is
  // what a mistyped or invented one looks like to the service.
  const missing = newBoardId();
  await page.goto(boardPath(missing));

  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await expect(page.getByText('Board not found')).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);
  // Nothing was created at that address: the page did not quietly mint a board there.
  expect((await request.get(`/api/boards/${missing}`)).status()).toBe(404);

  // The page's own way out: a New board button, which makes a different board.
  await page.getByTestId('new-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const made = new URL(page.url()).pathname.slice('/b/'.length);
  expect(made).not.toBe(missing);

  // The address that was not found is still not found: the second board did not move
  // into it, and the person did not lose the board they now have.
  expect((await request.get(`/api/boards/${missing}`)).status()).toBe(404);
  await page.goto(boardPath(missing));
  await expect(page.getByTestId('not-found-page')).toBeVisible();
});

test('TC-28 a service that is not answering when a link is opened is retried, not reported missing', async ({
  page,
  request,
  baseURL,
}) => {
  const boardId = await createBoard(request);

  // Down at the moment of opening: the request is dropped, so the page cannot ask.
  await page.route(isBoardApi, (route) => route.abort());
  await page.goto(boardPath(boardId));

  // What the person sees is "we could not ask", not "there is nothing there".
  await expect(page.getByTestId('board-unreachable')).toBeVisible();
  await expect(page.getByText(/Retrying/)).toBeVisible();
  await expect(page.getByText('Board not found')).toHaveCount(0);
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // The service comes back on its own. No reload, no second click: the page asks again.
  let reloaded = false;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reloaded = true;
  });
  await page.unroute(isBoardApi);

  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('share-open')).toBeVisible();
  expect(reloaded, 'the board should have appeared without reloading the page').toBe(false);
  expect(page.url()).toBe(new URL(boardPath(boardId), baseURL ?? '/').href);
});

test('TC-29 a clipboard the browser refuses still gets the link to the other person', async ({
  page,
}) => {
  // Refused before the page exists: the clipboard is there, and says no, exactly as a
  // denied permission does.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Failed to execute writeText', 'NotAllowedError');
        },
        readText: async () => '',
      },
    });
  });

  await gotoBoard(page);
  const boardUrl = page.url();

  await page.getByTestId('share-open').click();
  await page.getByTestId('share-copy').click();

  // The honest sentence, and the link left selected so the shortcut works.
  await expect(page.getByTestId('share-manual')).toBeVisible();
  await expect(page.getByTestId('share-manual')).toContainText('Ctrl+C');
  await expect(page.getByTestId('share-manual')).toContainText('Cmd+C');
  await expect(page.getByTestId('share-copy')).toContainText('Copy link');

  const selection = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="share-link"]',
    );
    if (!input) throw new Error('share link field missing');
    return {
      value: input.value,
      selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
      focused: document.activeElement === input,
      disabled: input.disabled,
    };
  });
  expect(selection.value).toBe(boardUrl);
  expect(selection.selected).toBe(true);
  expect(selection.focused).toBe(true);
  // The field is not disabled, so the selection is live and the keyboard shortcut has
  // something to copy. (It is read-only — nobody edits a link — which does not stop a
  // copy: the person copies the selection, not the field.)
  expect(selection.disabled).toBe(false);

  // A second try is allowed: nothing about a refusal puts the panel out of use.
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-manual')).toBeVisible();
});

test('TC-31 a board that was used before links existed still opens at its address', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('baseURL is set by playwright.config.ts');
  // A board with story 4 shape on disk: the tables, real Yjs update rows, and no
  // `created_at`, because nothing stamped one. This is what a board that predates this
  // feature looks like to the service.
  const boardId = newBoardId();
  const fixture = retroBoard25();
  const seeded = await fetch(`${baseURL}/__test/boards/${boardId}/seed-legacy`, {
    method: 'POST',
    body: JSON.stringify({
      updates: fixture.updates.map((update) => btoaOf(update)),
    }),
  });
  expect(seeded.status, 'the legacy seed hook should have run').toBe(200);
  expect(((await seeded.json()) as { rows: number }).rows).toBeGreaterThan(0);
  // And it was stamped as created by nobody: that is the point of the fixture.
  const existence = await fetch(`${baseURL}/api/boards/${boardId}`);
  expect(existence.status, 'a board with content on disk exists, created_at or not').toBe(
    200,
  );

  // The link opens the board, with its notes, and does not say "not found".
  await page.goto(boardPath(boardId));
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByText('Board not found')).toHaveCount(0);
  await expect
    .poll(() => stickyIds(page), { timeout: 20_000 })
    .toHaveLength(fixture.notes.length);

  // And it is still writable, so "legacy" does not mean "read-only museum piece".
  const noteId = await createByToolbar(page);
  await page.keyboard.type('still works', { delay: 15 });
  await endEditing(page);
  await expect
    .poll(() => noteTextContent(page, noteId), { timeout: 15_000 })
    .toBe('still works');
});

/** Base64 of the bytes of a Yjs update, as the legacy seed hook wants them. */
function btoaOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
