/**
 * Boards, from the test's side of the network.
 *
 * A board is not something a test gets to invent any more: since story 5 an address the
 * server has never heard of is a board that is not there, and the page for it says so.
 * So every test that wants a board asks the server for one through the same route the
 * home page's button uses - `POST /api/boards` - and is handed back the address the server
 * chose. That is also what makes a shared-link test worth running: the link one page
 * pastes is a link a server actually made.
 */

import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

import { BASE_URL } from '../target.js';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config.js';

/** Ask the server under test for a board; returns the path to it, `/b/<id>`. */
export async function createBoardPath(request: APIRequestContext, base = BASE_URL): Promise<string> {
  const response = await request.post(`${base}/api/boards`);
  if (response.status() !== 201) {
    throw new Error(`POST /api/boards answered ${response.status()}: ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error(`POST /api/boards gave no id: ${JSON.stringify(body)}`);
  }
  return `/b/${body.id}`;
}

/** The id of a new board, for a test that talks to the room by id rather than by page. */
export async function createBoardId(request: APIRequestContext, base = BASE_URL): Promise<string> {
  return (await createBoardPath(request, base)).slice('/b/'.length);
}

/**
 * The clipboard, granted.
 *
 * `navigator.clipboard.writeText` works without permission in Chromium; *reading* is the
 * read that a test needs to check what a page actually put there, and that is the one the
 * browser gates. Without the grant a copy test would have to settle for the label the
 * button gives itself - which is a claim about the clipboard, not a look at it.
 */
export async function grantClipboard(context: BrowserContext, origin = BASE_URL): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
}

/**
 * What the clipboard holds, read from inside the page.
 *
 * The page is brought to the front first: the clipboard belongs to the focused document,
 * and in a test with two contexts open the one that just copied is not necessarily the one
 * the browser thinks is frontmost. A rejection here is a fact about the test's permissions
 * rather than about the product, so it is reported as such.
 */
export async function clipboardText(page: Page): Promise<string> {
  await page.bringToFront();
  try {
    return await page.evaluate(() => navigator.clipboard.readText());
  } catch (error) {
    throw new Error(
      `the page could not read the clipboard back (${String(error)}); a test that reads it ` +
        'needs grantClipboard() on its context',
    );
  }
}

/** The address in the address bar. */
export const addressOf = (page: Page): Promise<string> => Promise.resolve(page.url());

/** The board this page is on, by the board's own account (test build only). */
export async function boardIdOnPage(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.__vidi6Board?.getBoardId());
  if (id === undefined) throw new Error('this page is not on a board');
  return id;
}

/** A board page is a board page: the viewport is drawn at the standard view. */
export async function expectBoardPage(page: Page): Promise<void> {
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('zoom-label')).toHaveText('100%');
}

/**
 * Wait until this page really holds a board document.
 *
 * A board page is put together in two moves now: the page loads, asks the server whether
 * there is a board at this address, and only when the answer comes back is the board
 * mounted. `page.goto()` answers at the end of the first move, so a test that reaches for
 * the document hooks as soon as it lands can arrive before the board does - and those hooks
 * answer by throwing, which Playwright's `expect.poll` counts as a failed assertion rather
 * than as a page that is still opening. The message would then read "the e2e suite needs the
 * test build" about a server that is serving exactly that build, which is a lie about the
 * product. So a test that wants the document asks for it by name, and waits.
 */
export async function waitForBoard(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window.__vidi6Board ? 'mounted' : 'opening')), {
      message: `the board never mounted on ${page.url()}`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('mounted');
}
