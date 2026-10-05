/**
 * E2E (story 4, TC-24): a board that cannot be opened.
 *
 * This is the case the whole story exists to avoid: somebody opens a link and the board
 * is not there. The dishonest versions of that moment are a blank board — which invites
 * them to rebuild a workshop over the top of the real one — and a spinner, which is what
 * every other failure in this app looks like. So a browser opens a board whose stored
 * snapshot has been damaged for real, inside the Durable Object's SQLite, and the claims
 * are the ones a person would repeat back:
 *
 *  - it says the board could not be loaded, in red, and shows no notes at all;
 *  - it will not let them type, draw, drag, recolour or delete;
 *  - when the storage is fixed, the board appears in the tab they were already in, and
 *    editing comes back, without a reload.
 *
 * The damage comes from the Worker's `/__test/` hook, which exists only because this
 * server runs with `TEST_HOOKS=1` (`playwright.config.ts`) and which a deployed Worker
 * does not have — `tests/integration/test-hooks.test.ts` is what pins that down.
 */

import { expect, test, type Page } from '@playwright/test';
import { doubleClickBoard, getBoard, notes, stickyInput, stickyToolButton } from './helpers/board';
import { createBoardOn, openBoardAt } from './helpers/participants';

/** The exact words. They are a promise about the board, so they are checked as a string. */
const UNOPENABLE = "This board couldn't be loaded. Retrying…";

/** Six notes is enough to be a board somebody would miss, and quick to make. */
const NOTES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function badge(page: Page) {
  return page.locator('[data-vidi6="connection-status"]');
}

/**
 * What a design token says, in the form the browser paints. The badge is compared against
 * the token rather than against a colour written into this file, so the claim is "this is
 * the red the design reserves for this message" — and if the design changes the red, this
 * test follows it instead of failing.
 */
async function tokenColour(page: Page, token: string): Promise<string> {
  const raw = await page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
    token
  );
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(raw.trim());
  if (!hex) {
    throw new Error(`${token} should be a #rrggbb colour to compare against, got ${JSON.stringify(raw)}`);
  }
  return `rgb(${[1, 2, 3].map((group) => Number.parseInt(hex[group] as string, 16)).join(', ')})`;
}

/** The badge's own background and text colour, as the browser painted them. */
async function paintedColours(page: Page): Promise<{ background: string; colour: string }> {
  const style = await badge(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { background: computed.backgroundColor, colour: computed.color };
  });
  return style;
}

test('a board that cannot be opened says so, keeps hands off, and comes back', async ({
  browser,
  request
}) => {
  // The room will not read the board again inside `LOAD_RETRY_MIN_INTERVAL_MS`, and the
  // client will not ask again inside its own reconnect backoff, so this test spends its
  // time waiting on two clocks rather than on a slow machine.
  test.setTimeout(150_000);

  // Made through the API, because an address nobody created is a page that says so.
  const boardId = await createBoardOn();

  // 1. A board with something on it, made the way anybody would make it.
  const maker = await browser.newContext();
  const makerPage = await maker.newPage();
  await openBoardAt(makerPage, boardId);
  for (const text of NOTES) {
    await stickyToolButton(makerPage).click();
    const editor = stickyInput(makerPage);
    await expect(editor).toBeVisible();
    await editor.fill(text);
    // Board space, away from the note stacked in the middle and from the chrome.
    await makerPage.mouse.click(900, 680);
  }
  await expect
    .poll(() => getBoard(makerPage), { message: 'six notes should be on the board' })
    .toHaveLength(NOTES.length);
  const written = (await getBoard(makerPage)).map((note) => note.text).sort();
  expect(written).toEqual([...NOTES].sort());
  // The board is left, so nobody is holding it when it is damaged.
  await maker.close();

  // 2. Its snapshot is damaged where only the board itself can reach it.
  const corrupted = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
  expect(corrupted.status()).toBe(200);
  expect((await corrupted.json()).ok).toBe(true);

  // 3. A stranger opens the link.
  const visitor = await browser.newContext();
  const page = await visitor.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  // Not `openBoardAt`: that helper waits for the board to be in sync, which is the one
  // thing this board will not be until it is repaired.
  await page.goto(`/b/${boardId}`);

  await expect(badge(page)).toHaveText(UNOPENABLE);
  const { background, colour } = await paintedColours(page);
  const redBackground = await tokenColour(page, '--status-red-background');
  const redInk = await tokenColour(page, '--status-red-ink');
  expect(background, 'the message is the red reserved for it').toBe(redBackground);
  expect(colour, 'and readable ink on it').toBe(redInk);

  // No notes. An empty board is the one answer that must never be given here: it is the
  // answer that gets a workshop rebuilt over the top of the real one.
  await expect(notes(page)).toHaveCount(0);

  // And nothing to type into. The toolbar says no by looking like it does; a
  // double-click on the board makes nothing; the notes, had there been any, could not be
  // moved, recoloured or deleted (that half is component-tested, because here there is
  // nothing on the screen to hold).
  await expect(stickyToolButton(page)).toBeDisabled();
  await doubleClickBoard(page, 300, 640);
  await expect(notes(page)).toHaveCount(0);
  await expect(await getBoard(page)).toHaveLength(0);

  // 4. The storage is repaired. The person waiting in front of the message does not have
  // to reload, click anything, or know that anything was done.
  await page.evaluate(() => {
    // A mark on this window: if it is still there at the end, this really is the same
    // page rather than a fresh one.
    (window as unknown as { __vidi6SamePage?: string }).__vidi6SamePage = 'yes';
  });
  const repaired = await request.post(`/__test/boards/${boardId}/repair`);
  expect(repaired.status()).toBe(200);
  expect((await repaired.json()).ok).toBe(true);

  await expect(notes(page), 'the board should arrive in the tab that was waiting').toHaveCount(
    NOTES.length,
    { timeout: 45_000 }
  );
  await expect(badge(page)).toHaveCount(0);
  expect((await getBoard(page)).map((note) => note.text).sort()).toEqual([...NOTES].sort());
  expect(await page.evaluate(() => (window as unknown as { __vidi6SamePage?: string }).__vidi6SamePage)).toBe(
    'yes'
  );

  // Editing is back, in the same page, and the board takes the change.
  await expect(stickyToolButton(page)).toBeEnabled();
  await stickyToolButton(page).click();
  await expect(notes(page)).toHaveCount(NOTES.length + 1);
  await expect
    .poll(() => getBoard(page), { message: 'the new note should be stored' })
    .toHaveLength(NOTES.length + 1);

  expect(consoleErrors, 'a broken board must not break the page').toEqual([]);

  await visitor.close();
});
