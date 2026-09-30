// Story 5, told in a real browser: a board is made, its link is copied, and a
// second person opens that link to find the same board; a link that is not a
// board says so and makes nothing; a refused clipboard still gets a copyable link;
// the board link is not leaked to another origin; and a board that predates the
// link feature opens like any other.
//
// These use the suite's shared `wrangler dev` (real WebSockets, real Yjs, real
// clipboard where the engine allows) except TC-31, which needs the test-only
// legacy-seed hook and so owns a persistent server with hooks on.
//
// Specs: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
// sections share.create (TC-26), share.not_found (TC-27), share.share_panel
// (TC-28), share.no_referrer_leak (TC-29), share.legacy_boards (TC-31).
import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import { settle } from './helpers/board';
import {
  createNote,
  expectEventually,
  openParticipantAt,
  stopEditing,
  type Participant,
} from './helpers/participants';
import { PersistentServer } from './helpers/persistent-server';

/** The board id a page is on, read back out of its address. */
async function boardIdOfPage(page: Page): Promise<string> {
  const path = await page.evaluate(() => window.location.pathname);
  const match = /^\/b\/([^/?#]+)$/.exec(path);
  if (match === null) throw new Error(`the page is not on a board address (${path})`);
  return decodeURIComponent(match[1] as string);
}

/**
 * The real clipboard, where the engine lets us read it back. Chromium and Firefox
 * with the granted permission do; where it is refused we get null and the caller
 * only checks the field, not a promise the engine will not keep.
 */
async function readClipboard(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  });
}

/** Open the share panel, copy the link, and hand back the link text. */
async function copyShareLink(page: Page): Promise<string> {
  await page.getByTestId('share-button').click();
  const field = page.getByTestId('share-link-field');
  await expect(field).toBeVisible();
  const value = await field.inputValue();
  await page.getByTestId('copy-link-button').click();
  await expect(page.getByTestId('share-panel').getByText('Copied')).toBeVisible();
  const clipboard = await readClipboard(page);
  if (clipboard !== null) {
    expect(clipboard, 'the copied clipboard matches the field').toBe(value);
  }
  return value;
}

/** A real Yjs update holding one note with `text`, base64 like the wire format. */
function legacyUpdates(text: string): string[] {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 300, y: 300 });
  getStickyText(doc, id)?.insert(0, text);
  return [Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')];
}

test('a board is shared by its link (TC-26)', async ({ browser }) => {
  // A person makes a board from home and puts something on it.
  const alex = await openParticipantAt(browser, '/', 'Alex', { create: true });
  const boardId = await boardIdOfPage(alex.page);
  const note = await createNote(alex, 400, 300, 'shared by link');
  await stopEditing(alex);

  // They copy the board's link from the share panel.
  const link = await copyShareLink(alex.page);
  expect(link).toBe(`${new URL(alex.page.url()).origin}/b/${boardId}`);

  // Another person opens that link in a context that shares nothing else, and
  // finds the same board: the note is there.
  const sam = await openParticipantAt(browser, link, 'Sam');
  await expectEventually('Sam sees the note that was already on the board', () => sam.note(note), {
    is: (found) => found?.text === 'shared by link',
  });

  await sam.close();
  await alex.close();
});

test('a board link that is not a board says so and makes nothing (TC-27)', async ({ page }) => {
  // A link of a real shape for a board that was never made.
  const missing = newBoardId();
  await page.goto(`/b/${missing}`);
  await expect(page.getByTestId('board-not-found')).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // Opening it did not invent a board: the server still has no such board.
  const status = await page.evaluate((id) => fetch(`/api/rooms/${id}`).then((r) => r.status), missing);
  expect(status).toBe(404);

  // A mistyped id that is not even a board id is the same outcome, told without
  // ever asking the server.
  await page.goto('/b/not-a-board-id!!');
  await expect(page.getByTestId('board-not-found')).toBeVisible();
});

test('a refused clipboard still leaves a link to copy by hand (TC-28)', async ({ page, context }) => {
  // A browser whose clipboard refuses to be written to.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('not allowed')) },
    });
  });
  await page.goto('/');
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await settle(page);

  await page.getByTestId('share-button').click();
  const field = page.getByTestId('share-link-field');
  const value = await field.inputValue();
  expect(value).toContain('/b/');

  await page.getByTestId('copy-link-button').click();
  // Told what happened, and given a link it can select and copy itself.
  await expect(page.getByTestId('share-panel').getByText(/Copy the link above/)).toBeVisible();
  await expect(field).toHaveValue(value);
});

test('the board link is not sent to another origin as a Referer (TC-29)', async ({ page }) => {
  // The served document asks for no referrer, on every route.
  await page.goto('/');
  expect(await page.locator('meta[name="referrer"][content="no-referrer"]').count()).toBe(1);

  // Make a board, so the browser's current address really is a board link.
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await settle(page);
  expect(page.url()).toContain('/b/');

  // Try to leave for another origin. The request is intercepted before it goes
  // out, so we can read what it would have carried.
  let fired = false;
  let referer: string | null | undefined = undefined;
  // Read through a function: the only assignment TypeScript can see in the control
  // flow is the initialiser, because a route callback is not modelled as running
  // before the assertion below. Without this the variable is narrowed to `undefined`
  // and the `includes` call below has nothing to call `includes` on.
  const readReferer = (): string | null | undefined => referer;
  await page.route('http://referer-probe.invalid/**', (route) => {
    fired = true;
    referer = route.request().headers()['referer'];
    void route.abort();
  });
  await page.evaluate(() => {
    window.location.assign('http://referer-probe.invalid/probe');
  });
  await expect
    .poll(() => fired, { timeout: 8_000 })
    .toBe(true);

  // No Referer at all, or none that names the board — the link does not go with
  // the visit.
  const seen = readReferer();
  expect(
    seen === undefined || seen === null || !seen.includes('/b/'),
    `referer=${String(seen)}`,
  ).toBe(true);
});

test('a board that was there before links still opens it (TC-31)', async ({ browser }) => {
  test.setTimeout(180_000);
  // A server of its own, because this board is arranged with the test-only
  // legacy-seed hook (updates, no `created_at`) the shared server does not carry.
  const server = await PersistentServer.create({ testHooks: true });
  try {
    await server.start();
    const boardId = newBoardId();
    await server.seedLegacyBoard(boardId, legacyUpdates('from before story five'));

    // Opening it by its link is not a "not found": the board is there.
    const alex: Participant = await openParticipantAt(
      browser,
      server.boardUrl(boardId),
      'Alex',
    );
    await expect(alex.page.getByTestId('board-viewport')).toBeVisible();
    await expect(alex.page.getByTestId('board-not-found')).toHaveCount(0);

    // And it is recognized as the same board: the note that was put there before
    // the link feature is on it.
    await expectEventually(
      'the note from before the link feature is on the board',
      async () => [...(await alex.notes()).values()].some((n) => n?.text === 'from before story five'),
      { is: (found) => found === true },
    );

    await alex.close();
  } finally {
    await server.cleanup();
  }
});
