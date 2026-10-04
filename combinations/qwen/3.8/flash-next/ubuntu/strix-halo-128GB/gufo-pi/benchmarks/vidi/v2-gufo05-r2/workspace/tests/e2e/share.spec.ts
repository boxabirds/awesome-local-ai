/**
 * Story 5, in browsers, against the server the config starts (`npm run e2e:serve`,
 * with the test hooks armed).
 *
 * The unit, integration and component tests can say that a link code is unguessable,
 * that a 404 means "nobody made this board", and that a refused clipboard leaves the
 * link selected. What only a browser can say is the thing the story is actually for:
 * one person presses a button, the text that lands in a chat window takes another
 * person to the same board, and both of them can write on it.
 *
 * TC-26  create, share, join — the golden path, in both directions
 * TC-27  a bad link: the message, and a board of your own from it
 * TC-28  the service is unreachable when the link is opened, and comes back
 * TC-29  the clipboard is blocked: the link is ready to copy by hand
 * TC-31  a board from before this story still opens
 *
 * Functional waits use E2E_EVENTUAL_TIMEOUT_MS. The one duration this story cares
 * about — New board to open board — is measured and logged, never asserted: a slow
 * machine is not a broken share link (CREATE_BUDGET_MS is the number to beat).
 */

import { expect, test, type Page } from '@playwright/test';

import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { boardStatusAt } from '../fixtures/board-api';
import { boardHooks } from '../fixtures/hooks';
import { createNoteByDblClick, endEditing, getNotes, typeIntoEditor } from './helpers/notes';

/** The server the config runs for these cases. */
const SHARED_ORIGIN = `http://127.0.0.1:${Number(process.env.VIDI6_E2E_PORT ?? 28736)}`;

const BOARD_ID_IN_URL = /\/b\/([A-Za-z0-9_-]{22})$/;

/** The address a person would be copying out of the Share panel. */
function linkOf(page: Page): string {
  return page.url();
}

test('TC-26: one person makes a board, another arrives on it by the link', async ({
  page,
  context,
  browser,
}, testInfo) => {
  // Chromium only: reading the clipboard back is the clipboard permission this case
  // needs, and the other two browsers do not grant it at all.
  test.skip(testInfo.project.name !== 'chromium', 'needs clipboard permissions');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: SHARED_ORIGIN,
  });

  // Maya, from the home page, the way a first visit goes.
  await page.goto('/');
  const started = Date.now();
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const openedIn = Date.now() - started;
  console.log(`TC-26: New board to open board took ${openedIn} ms (budget ${CREATE_BUDGET_MS} ms)`);

  const boardId = BOARD_ID_IN_URL.exec(page.url())?.[1];
  expect(boardId, 'the board opened at a link code').toBeTruthy();
  expect(await getNotes(page)).toHaveLength(0);

  const text = 'written before anybody else was invited';
  const noteId = await createNoteByDblClick(page, { x: 520, y: 380 });
  await typeIntoEditor(page, text);
  await endEditing(page);

  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await expect(page.getByTestId('share-link')).toHaveValue(`${SHARED_ORIGIN}/b/${boardId}`);
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toContainText('Link copied');

  // What went onto the clipboard is the whole address, which is the only thing that
  // would work pasted somewhere else.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`${SHARED_ORIGIN}/b/${boardId}`);

  // Sam, in a browser of their own, arriving from that text. No sign-in, no prompt,
  // no board-choosing dialog: a link, and then the board.
  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  try {
    await sam.goto(copied);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    await expect
      .poll(async () => (await getNotes(sam)).some((note) => note.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: "Sam should see Maya's note",
      })
      .toBe(true);

    // And Sam is not a visitor behind glass: the note can be written in.
    const edit = ' and Sam was here';
    await sam.locator(`[data-note-id="${noteId}"]`).dblclick();
    await typeIntoEditor(sam, edit);
    await endEditing(sam);

    await expect
      .poll(
        async () => (await getNotes(page)).find((note) => note.id === noteId)?.text ?? '',
        { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'Maya should see Sams edit' },
      )
      .toContain('Sam was here');

    // The link took Sam to Maya's board, not to a second board that happens to look
    // like it.
    expect(sam.url()).toBe(linkOf(page));
  } finally {
    await samContext.close();
  }
});

test('TC-27: a link to a board nobody made says so, and offers a board of your own', async ({
  page,
}) => {
  const missing = newBoardId();
  await page.goto(`/b/${missing}`);

  await expect(page.getByTestId('not-found-page')).toContainText('Board not found');
  await expect(page.getByTestId('not-found-page')).toContainText(
    'Check the link, or ask the person who shared it to send it again.',
  );
  // Nothing was made at the address that was only typed at it.
  expect(await boardStatusAt(SHARED_ORIGIN, missing)).toBe(404);

  // The offer on that page is a real way forward: a board of this person's own, empty,
  // at a different address.
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const made = BOARD_ID_IN_URL.exec(page.url())?.[1];
  expect(made).toBeTruthy();
  expect(made).not.toBe(missing);
  expect(await getNotes(page)).toHaveLength(0);
});

test('TC-28: a board that could not be reached opens when the service comes back', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/boards');
  expect(response.ok()).toBe(true);
  const { id } = (await response.json()) as { id: string };

  // The board exists. The way to it does not answer, which is not the same message and
  // must not become "Board not found" — that message would send the person away from a
  // board that is waiting for them.
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-unreachable')).toContainText(
    "Couldn't reach vidi6. Retrying…",
  );
  expect(await boardStatusAt(SHARED_ORIGIN, id)).toBe(200);

  // The service returns. The page asks again on its own: nobody reloads.
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('board-viewport')).toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  await expect(page.getByTestId('connection-status')).toHaveCount(0);
});

test('TC-29: when the browser will not copy, the link is ready to copy by hand', async ({
  page,
  context,
}) => {
  // A browser that refuses the clipboard, which is what an insecure origin, a private
  // window or a person who has said no once looks like to this page.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('refused by this test')) },
    });
  });

  await page.goto('/');
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();

  await page.getByTestId('share-button').click();
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-manual')).toContainText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );

  const field = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="share-link"]');
    return input
      ? {
          value: input.value,
          selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
          focused: document.activeElement === input,
        }
      : null;
  });
  expect(field?.value).toBe(page.url());
  expect(field?.selected).toBe(true);
  expect(field?.focused).toBe(true);
});

test('TC-31: a board that was here before links existed still opens', async ({ page }) => {
  const hooks = boardHooks(SHARED_ORIGIN);
  const boardId = newBoardId();

  // A board written the way boards were written before this story: content on disk,
  // and no `created_at` anywhere — `seed` predates the idea that a board has a moment
  // of creation. The rule that this counts as an existing board is pinned against real
  // SQLite in the integration suite (TC-08); what is pinned here is that the person
  // gets their board rather than a message about it.
  const seeded = await hooks.seed(boardId, 'retro');
  expect(seeded.notes).toBeGreaterThan(0);

  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(async () => (await getNotes(page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: 'the seeded notes should be on screen',
    })
    .toBe(seeded.notes);
  expect(page.getByTestId('not-found-page')).toHaveCount(0);
});
