/**
 * Story 5 · end-to-end share workflows (TC-26 … TC-31).
 *
 * These are the paths the whole story is about: a board is *made* on the
 * Worker, its address is *carried* to another person, and an address that holds
 * no board is refused. Everything runs against `wrangler dev`, so the Worker
 * routing, the Durable Object and its SQLite file are the real ones.
 *
 * Three deliberate choices:
 *
 *  - A board is created the way a visitor creates one (the Home button) or
 *    through the same `POST /api/boards` the button calls. Story 3 let any
 *    `/b/<id>` address mint a board; that is what this story removes, so a test
 *    can no longer invent an address and expect a canvas.
 *  - The shared link is read back **out of the clipboard** where the browser
 *    lets us (TC-26), because "copy, then open it elsewhere" is the workflow
 *    under test; where it does not (TC-29), the clipboard is made to fail on
 *    purpose and the assertion is about the fallback.
 *  - The rate-limit case runs against its own server on a third port
 *    (`--env e2e_limited`, 10 creates a minute), so the twelve creates it makes
 *    cannot starve the other cases of their allowance.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS } from '../../src/shared/config';
import { makeRetroDoc } from '../fixtures/boards';
import { createNoteAt, readNotes, settle } from './helpers/sticky';
import { openFreshBoard } from './helpers/boards';

/**
 * The board page's "can't reach the service" line. Spelled out here rather
 * than imported because `BoardPage.tsx` pulls in React and the canvas, which a
 * Node-side spec cannot load; the component suite (TC-21) asserts the same
 * string from the module itself, so the two cannot drift silently.
 */
const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

/** The not-found copy, kept in one place so a wording change is one edit. */
const NOT_FOUND_TITLE = 'Board not found';

/** The two messages the Home page shows when creating is refused. */
const CREATE_FAILED_TEXT = "Couldn't create a board. Please try again.";
const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";

/** A well-formed id that nobody created (22 base64url characters). */
function unknownBoardId(): string {
  return randomBytes(16).toString('base64url');
}

async function notesOf(page: Page): Promise<number> {
  return (await readNotes(page)).length;
}

/** Open a link the way its *recipient* does: paste it into a fresh browser. */
async function openLinkAsVisitor(context: BrowserContext, link: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

test.describe('create, share, join', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'this case reads the system clipboard back, which only Chromium lets a test do',
  );

  test('TC-26 Maya copies a link and Sam opens it', async ({ browser, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // ---- Maya creates a board and puts something on it --------------------
    const maya = await context.newPage();
    const started = Date.now();
    const boardId = await openFreshBoard(maya);
    const elapsedMs = Date.now() - started;
    console.log(
      `TC-26: create + open in ${elapsedMs}ms (share.create budget ${CREATE_BUDGET_MS}ms)`,
    );
    await createNoteAt(maya, 420, 320);
    await settle(maya);
    await expect.poll(() => notesOf(maya), { timeout: 15_000 }).toBe(1);

    // ---- the Share panel, and the clipboard it writes -------------------
    await maya.getByTestId('share-button').click();
    await expect(maya.getByTestId('share-panel')).toBeVisible();
    await expect(maya.getByTestId('share-link')).toHaveValue(
      `http://localhost:8787/b/${boardId}`,
    );
    await expect(maya.getByTestId('share-note')).toHaveText(
      'Anyone with this link can view and edit this board.',
    );

    await maya.getByTestId('share-copy').click();
    await expect(maya.getByTestId('share-copy')).toHaveText('\u2713 Link copied');

    const link = await maya.evaluate(async () => navigator.clipboard.readText());
    expect(link).toBe(`http://localhost:8787/b/${boardId}`);

    // ---- Sam: a browser that has never seen this board ------------------
    const samContext = await browser.newContext();
    const seen: string[] = [];
    samContext.on('request', (request) => {
      for (const name of Object.keys(request.headers())) {
        if (['cookie', 'authorization', 'x-board-secret'].includes(name.toLowerCase())) {
          seen.push(`${name} ${request.url()}`);
        }
      }
    });
    const sam = await openLinkAsVisitor(samContext, link);

    // The link *is* the access path: no sign-in, no join step, no approval.
    await expect(sam.getByTestId('board-viewport')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => notesOf(sam), { message: 'Sam sees Maya\u2019s note' })
      .toBe(1);

    // ---- Sam edits; Maya sees it ----------------------------------------
    await createNoteAt(sam, 700, 380);
    await expect
      .poll(() => notesOf(maya), { message: 'the edit travels back to Maya' })
      .toBe(2);
    expect(seen, 'no session travels with a board link').toEqual([]);

    // The confirmation is a moment, not a state: it clears by itself.
    await expect(maya.getByTestId('share-copy')).toHaveText('Copy link', { timeout: 5_000 });
    await samContext.close();
  });
});

test('TC-27 a bad link recovers into a real board', async ({ page }) => {
  test.setTimeout(120_000);

  // A well-formed address for a board that was never created: no request
  // creates it, and nothing is written while the answer is worked out.
  await page.goto(`/b/${unknownBoardId()}`);
  await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('not-found-title')).toHaveText(NOT_FOUND_TITLE);
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // A malformed address lands in the same place, and the client never even
  // asks the Worker about it (design: no distinction, nothing leaked).
  await page.goto('/b/not-a-board');
  await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 20_000 });

  // The way out is a board: "Create a new board" makes one, and it is empty.
  await page.getByTestId('create-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 30_000 });
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 30_000 });
  await settle(page);
  expect(await notesOf(page)).toBe(0);

  // And the home link works from the same page.
  await page.goto('/b/still-not-a-board');
  await page.getByTestId('home-link').click();
  await expect(page).toHaveURL('http://localhost:8787/');
  await expect(page.getByTestId('create-board')).toBeVisible();
});

test('TC-28 a board whose service is unreachable retries and opens', async ({ page }) => {
  test.setTimeout(150_000);

  // A board that exists, so the only thing missing at first is the service.
  const boardId = await openFreshBoard(page);
  await createNoteAt(page, 380, 260);
  await settle(page);
  await expect.poll(() => notesOf(page)).toBe(1);

  // ---- now: the existence check cannot get through ------------------------
  const flaky = await page.context().newPage();
  await flaky.route('**/api/boards/**', (route) => route.abort());
  await flaky.goto(`/b/${boardId}`);
  await expect(flaky.getByTestId('board-loading-message')).toHaveText(UNREACHABLE_MESSAGE, {
    timeout: 20_000,
  });
  // Still no canvas: an unreachable service is never shown as an empty board.
  await expect(flaky.getByTestId('board-viewport')).toHaveCount(0);

  // ---- the service comes back; the page notices on its own ----------------
  await flaky.unroute('**/api/boards/**');
  await expect(flaky.getByTestId('board-viewport')).toBeVisible({ timeout: 40_000 });
  await expect
    .poll(() => notesOf(flaky), { message: 'the retry loads the real board' })
    .toBe(1);
});

test('TC-29 a blocked clipboard leaves the link selectable', async ({ page }) => {
  test.setTimeout(120_000);

  // Simulate a browser that refuses a clipboard write in this context: the
  // promise rejects, which is the path the panel has to handle.
  await page.addInitScript(() => {
    const clipboard = { writeText: () => Promise.reject(new Error('denied')) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  });

  await openFreshBoard(page);
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-copy').click();

  await expect(page.getByTestId('share-manual')).toHaveText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );
  // The field is focused and its whole content is selected, so one keystroke
  // finishes what the button could not.
  const selected = await page.getByTestId('share-link').evaluate((element) => {
    const field = element as HTMLInputElement;
    return {
      value: field.value,
      selected: field.selectionStart === 0 && field.selectionEnd === field.value.length,
      focused: document.activeElement === field,
    };
  });
  expect(selected.value).toMatch(/^http:\/\/localhost:8787\/b\/[A-Za-z0-9_-]{22}$/);
  expect(selected.selected).toBe(true);
  expect(selected.focused).toBe(true);

  // Escape closes the panel, and focus goes back to the Share button.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('share-panel')).toHaveCount(0);
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-testid'),
  );
  expect(focused).toBe('share-button');
});

test.describe('abuse guard', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'one server, one rate-limit window: the case is about the limit, not the engine',
  );

  test('TC-30 the twelfth board in a minute is refused', async ({ browser }) => {
    test.setTimeout(240_000);

    // The dedicated server (`--env e2e_limited`) carries the production limit.
    const limited = 'http://localhost:8789';
    const context = await browser.newContext({ baseURL: limited });
    const visitor = await context.newPage();
    await visitor.goto(`${limited}/`);

    // The limit is one visitor per minute. A brand-new context still shares the
    // server's single bucket (locally every request answers to one anonymous
    // visitor), so the allowance is drained here, in the open, and what the
    // rest of the case asserts is the *refusal* — which is the feature.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < BOARD_CREATE_LIMIT; attempt += 1) {
      const response = await visitor.request.post(`${limited}/api/boards`);
      statuses.push(response.status());
    }
    // Whatever the window held before, it is spent now: the next attempt is a
    // 429. (The exact split of the drained requests is reported, not asserted:
    // the same server answers all three browser projects.)
    console.log(`TC-30: drained the window with ${statuses.join(' ')}`);

    // The visitor-level truth: the button still works, and the message is the
    // rate-limit one, not the generic failure.
    await visitor.getByTestId('create-board').click();
    await expect(visitor.getByTestId('create-message')).toHaveText(RATE_LIMITED_TEXT, {
      timeout: 20_000,
    });
    await expect(visitor).toHaveURL(`${limited}/`);
    await expect(visitor.getByTestId('create-board')).toBeEnabled();
    await expect(visitor.getByTestId('create-board')).toHaveText('Create a board');

    // A create that simply fails says something else, and does not navigate.
    const broken = await context.newPage();
    await broken.route('**/api/boards', (route) =>
      route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }),
    );
    await broken.goto(`${limited}/`);
    await broken.getByTestId('create-board').click();
    await expect(broken.getByTestId('create-message')).toHaveText(CREATE_FAILED_TEXT, {
      timeout: 20_000,
    });
    await expect(broken).toHaveURL(`${limited}/`);
    await expect(broken.getByTestId('create-board')).toBeEnabled();

    await context.close();
  });
});

test('TC-31 a board that predates the creation marker still opens', async ({ page }) => {
  test.setTimeout(120_000);

  // A legacy board: real content in the update log, and no `created_at`. This
  // is the shape a board written before this story has, and the existence rule
  // must not break it (PRD share.legacy_boards).
  const boardId = unknownBoardId();
  const { updates } = makeRetroDoc();
  const seeded = await page.request.post(`/__test/boards/${boardId}/seed-legacy`, {
    data: { updates: updates.map((update) => Buffer.from(update).toString('base64')) },
  });
  expect(seeded.status()).toBe(200);
  expect((await seeded.json()).ok).toBe(true);

  // The check calls it a board, and the link opens the notes it holds.
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 30_000 });
  await settle(page);
  expect(await notesOf(page)).toBeGreaterThan(0);

  // And the check really is a read: an address nobody seeded is still refused,
  // so the legacy rule did not become "everything exists".
  const empty = await page.request.get(`/api/boards/${unknownBoardId()}`);
  expect(empty.status()).toBe(404);
});
