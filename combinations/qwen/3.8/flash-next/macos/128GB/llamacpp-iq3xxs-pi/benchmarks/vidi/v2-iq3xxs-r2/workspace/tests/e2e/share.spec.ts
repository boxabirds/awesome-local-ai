import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { NOT_FOUND_HEADING, NOT_FOUND_TEXT } from '../../src/client/pages/NotFoundPage';
import { UNREACHABLE_MESSAGE } from '../../src/client/pages/state';
import {
  COPY_LINK_LABEL,
  MANUAL_COPY_MESSAGE,
} from '../../src/client/share/SharePanel';
import {
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { BOARD_URL, VIEWPORT_CENTRE, waitForCentredBoard } from './helpers/board';
import {
  applyChange,
  boardLink,
  clipboardContext,
  closeParticipants,
  copyLinkThroughPanel,
  createBoardLink,
  createNoteAt,
  createParticipants,
  endEditing,
  expectNoErrors,
  participantOf,
  textOf,
  typeInto,
} from './helpers/participants';
import { callTestHook, WranglerProcess } from './helpers/wrangler-process';

/**
 * Story 5 in real browsers against the real Worker: a board is made by the service, its
 * link leaves through the clipboard, and a second person opens that text. Everything here
 * goes through the same buttons a person uses, and the link is compared with what the
 * browser actually holds — never with a string the test built itself.
 *
 * Two of these are Chromium-only and say why: TC-26 reads the real clipboard back, which
 * is the one thing engines disagree about (the design forces the fallback path in every
 * engine instead, in TC-29); TC-31 needs a server whose test hooks are switched on, and
 * the shared server is deliberately built without them (story 4 tests that).
 */

/** A board link on a server the test owns, which is how TC-31 reaches its hooks. */
function absoluteLink(server: WranglerProcess, boardId: string): string {
  return `${server.url.replace(/\/$/, '')}${boardLink(boardId)}`;
}

test('TC-26 create, share, join: what the clipboard holds opens the same board for somebody else', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'the real clipboard is read back here, and permission to read it is engine-specific (TC-29 forces the other path everywhere)',
  );

  const mayaContext = await clipboardContext(browser);
  const mayaPage = await mayaContext.newPage();
  const maya = participantOf('Maya', mayaContext, mayaPage);

  // Home, one press, and a board: the whole of what story 5 adds to arriving.
  const pressedAt = Date.now();
  await mayaPage.goto('/');
  await mayaPage.getByTestId('new-board').click();
  await expect(mayaPage).toHaveURL(BOARD_URL);
  await waitForCentredBoard(mayaPage);
  const clickToBoardMs = Date.now() - pressedAt;
  console.log(
    `[create] home press to board on screen: ${clickToBoardMs}ms (budget ${CREATE_BUDGET_MS}ms, reported not asserted)`,
  );
  await expect(mayaPage.locator('[data-note-id]')).toHaveCount(0);

  const noteId = await createNoteAt(maya, VIEWPORT_CENTRE);
  await endEditing(maya);
  const link = await copyLinkThroughPanel(mayaPage);
  // The link the clipboard holds is exactly the address the bar holds.
  expect(link).toBe(mayaPage.url());

  // Sam is a different person in a different context: no shared storage, no shared
  // WebSocket, and nothing but the text Maya put on her clipboard.
  const samContext = await clipboardContext(browser);
  const samPage = await samContext.newPage();
  await samPage.goto(link);
  await waitForCentredBoard(samPage);
  await expect(samPage.locator(`[data-note-id="${noteId}"]`)).toHaveCount(1);

  // And the board is Sam's too: an edit Sam makes arrives back on Maya's screen.
  const sam = participantOf('Sam', samContext, samPage);
  await applyChange(
    "Sam's text inside Maya's note",
    sam,
    async () => {
      await typeInto(sam, noteId, 'sam was here');
    },
    [maya],
  );
  expect(await textOf(maya, noteId)).toBe('sam was here');
  expectNoErrors([maya, sam]);
  await closeParticipants([maya, sam]);
});

test('TC-27 bad link recovery: Board not found, and a New board from right there', async ({
  page,
}) => {
  // Valid on its face, and nobody has ever made it.
  const boardId = newBoardId();
  const link = boardLink(boardId);
  // The page itself answers 200 with the app; it is the app's own question to the service
  // that has to come back 404, so that is the response this test waits on.
  const existenceCheck = page.waitForResponse(
    (request) => new URL(request.url()).pathname === `/api/boards/${boardId}`,
  );
  await page.goto(link);
  expect((await existenceCheck).status(), `GET /api/boards/${boardId}`).toBe(404);

  await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();

  // The way out of a bad link is a good board, and this page offers it.
  await page.getByTestId('new-board').click();
  await expect(page).toHaveURL(BOARD_URL);
  await waitForCentredBoard(page);
  expect(new URL(page.url()).pathname, 'the board that got made').not.toBe(link);
  await expect(page.locator('[data-note-id]')).toHaveCount(0);
});

test('TC-28 flaky service on open: it says it is retrying, then opens the board on the page that is already there', async ({
  browser,
  page,
}) => {
  // A board that does exist: what fails here is the road, not the destination.
  const link = await createBoardLink(browser);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(link);

  await expect(page.getByTestId('board-status')).toHaveText(UNREACHABLE_MESSAGE, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  // Nothing has been decided about this board, in either direction.
  await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toHaveCount(0);
  await expect(page.getByTestId('viewport')).toHaveCount(0);
  // A mark a reload would wash away, so "without reloading" stays a thing that was checked.
  await page.evaluate(() => {
    Object.defineProperty(window, '__vidi6NotReloaded', { value: true });
  });

  await page.unroute('**/api/boards/*');
  // The next retry is the one that gets through. The wait covers the client's own backoff
  // ladder to its cap, plus the functional budget: the retry is what is being tested.
  await expect(page.getByTestId('viewport')).toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS + 2 * RECONNECT_MAX_BACKOFF_MS,
  });
  expect(await page.evaluate(() => (window as unknown as { __vidi6NotReloaded?: boolean }).__vidi6NotReloaded)).toBe(
    true,
  );
  expect(new URL(page.url()).pathname, 'nobody went anywhere').toBe(link);
});

test('TC-29 clipboard blocked: the link is selected in the field and said out loud', async ({
  browser,
  page,
}) => {
  const link = await createBoardLink(browser);
  // A clipboard that refuses, installed before any of the app's code runs — the way a
  // browser that answers the permission prompt with "no" behaves.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('NotAllowedError: refused by the test')),
      },
    });
  });
  await page.goto(link);
  await waitForCentredBoard(page);
  const address = page.url();

  await page.getByTestId('share-button').click();
  await page.getByTestId('copy-link').click();

  await expect(page.getByTestId('manual-copy-message')).toHaveText(MANUAL_COPY_MESSAGE);
  const selected = await selectionOf(page.locator('[data-testid="share-link"]'));
  expect(selected, 'the field is left holding exactly the link').toBe(address);
  // And the button never claimed to have done the thing it could not do.
  await expect(page.getByTestId('copy-link')).toHaveText(COPY_LINK_LABEL);
});

/** What the person would get if they pressed Ctrl+C right now. */
async function selectionOf(field: ReturnType<Page['locator']>): Promise<string> {
  return field.evaluate((element) => {
    const input = element as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  });
}

/* --------------------------------------------------------------------------
 * TC-31: the legacy board
 *
 * This one needs a server whose room test hooks are switched on, and the suite's shared
 * server is deliberately built without them — its missing hooks are themselves a story 4
 * assertion. So this test owns a second `wrangler dev`, on its own port and its own
 * storage, and reaches it by absolute address.
 * ----------------------------------------------------------------------- */

const LEGACY_PORT = Number(process.env.AGENT_PORT_E2E_LEGACY ?? 27430);
const legacyServer = new WranglerProcess(LEGACY_PORT, LEGACY_PORT + 1, ['TEST_HOOKS:1']);
let legacyStarted = false;

test('TC-31 a board that predates links still opens: its data is what makes it exist', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'whether a board exists is the server’s memory, not a behaviour the engines differ about',
  );
  if (!legacyStarted) {
    await legacyServer.start('legacy-board');
    legacyStarted = true;
  }

  const boardId = newBoardId();
  // Notes written through the room's own production path — every one went through the
  // store's append — and never through `POST /api/boards`, so nothing ever set
  // `created_at`. That is precisely the board a story 1 to story 4 visitor left behind.
  const seeded = await callTestHook(legacyServer, boardId, 'seed-notes', '?count=3');
  expect(seeded.status, `seed-notes on ${legacyServer.url}`).toBe(200);

  const [visitor] = await createParticipants(browser, absoluteLink(legacyServer, boardId), 1);
  const people = [visitor];
  try {
    await expect(visitor.page.getByRole('heading', { name: NOT_FOUND_HEADING })).toHaveCount(0);
    await expect(visitor.page.locator('[data-note-id]')).toHaveCount(3);
    // It is a board with an address now, so the address is shareable as it stands.
    expect(new URL(visitor.page.url()).pathname).toBe(boardLink(boardId));

    // The control that makes "its data is what makes it exist" mean something: the same
    // server, a board with neither a POST nor any data, is still simply not there.
    const control = await browser.newContext();
    const controlPage = await control.newPage();
    try {
      await controlPage.goto(absoluteLink(legacyServer, newBoardId()));
      await expect(controlPage.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
    } finally {
      await control.close();
    }
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test.afterAll(async () => {
  // Only a worker that started it has one; stopping nothing costs nothing.
  await legacyServer.stop();
  legacyServer.dispose();
});
