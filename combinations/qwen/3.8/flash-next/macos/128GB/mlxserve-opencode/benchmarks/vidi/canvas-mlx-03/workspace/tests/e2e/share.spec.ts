// Story 5's end-to-end share workflows (design "Verification workflow", TC-26 to
// TC-31): someone creates a board, copies its link, and a second visitor lands on
// that same board by opening the link.
//
// Run with `npm run test:e2e:share`. It builds the client and boots its own
// `wrangler dev` with `--var VIDI_TEST_HOOKS:1`, so a board can be seeded without
// spending the creation limit TC-30 measures — and so TC-30's own budget is not
// spent by the other tests in this file.
//
// Unlike the room/persistence suites, this file boots ONE wrangler process for the
// file and gives TC-30 its own second process: the board creation limit is counted
// per Worker process and per visitor, and that test asserts the exact boundary, so
// it must not share a counter with anything else.
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { createSticky as modelCreateSticky, initDoc } from '../../src/shared/board-model.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { BOARD_CREATE_LIMIT } from '../../src/shared/config.ts';
import buildClient from './helpers/build-client.ts';
// `startDevServer` already waits for the first real response, so nothing here
// measures a cold start.
import { startDevServer, type DevServer } from './helpers/wrangler-process.ts';
import { grantClipboardPermissions, readClipboard } from './helpers/clipboard.ts';
import { createSticky, noteCount, noteTexts, waitForConnection } from './helpers/board.ts';

const NOTE_TEXT = 'shared through a link';
const SAM_TEXT = 'added by the visitor who followed the link';
const LEGACY_TEXT = 'written before story 5 existed';

/**
 * Localhost answers a board in well under a second; `CREATE_BUDGET_MS` is the
 * server-side budget for creating one, and this is the same allowance a human
 * would call "it opened right away".
 */
const OPEN_TIMEOUT = 20_000;

let dev: DevServer;

test.beforeAll(async () => {
  buildClient();
  dev = await startDevServer();
});

test.afterAll(async () => {
  await dev.dispose();
});

// ---------------------------------------------------------------- helpers ----

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> ${response.status}: ${text}`);
}

/**
 * Stand up a board through the test hooks rather than the browser, so it does not
 * spend the creation rate limit TC-30 measures.
 *
 * With `updates` it uses `seed-legacy`, which writes real update rows and no
 * creation marker — a board saved before this story's create endpoint existed.
 * Without them it uses `initialize`, the same `BoardRoom.initialize()` the API
 * calls, minus the limiter in front of it.
 */
async function createBoard(updates: string[] = []): Promise<string> {
  const id = newBoardId();
  const action = updates.length > 0 ? 'seed-legacy' : 'initialize';
  await postJson(`${dev.url}/__test/boards/${id}/${action}`, { updates });
  return id;
}

/**
 * A note written the way story 3 wrote them: content rows, and no `created_at`
 * marker anywhere. This is what a board created before this story existed looks
 * like on disk.
 */
function legacyNoteUpdates(texts: string[]): string[] {
  const rows: string[] = [];
  const meta = new Y.Doc();
  initDoc(meta);
  rows.push(Buffer.from(Y.encodeStateAsUpdate(meta)).toString('base64'));
  texts.forEach((text, index) => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    Y.transact(doc, () => {
      const id = modelCreateSticky(doc, { x: 200 + index * 80, y: 200 }, 'yellow');
      const object = objects.get(id)!;
      (object.get('text') as Y.Text).insert(0, text);
      object.set('z', index + 1);
    });
    rows.push(Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'));
  });
  return rows;
}

/**
 * Add a note the way a visitor does — double-click the canvas, type, blur — at a
 * spot of our choosing so a second note is not dropped on top of the first.
 */
async function addNote(page: Page, text: string, x = 600, y = 400): Promise<void> {
  await createSticky(page, x, y, text);
  await expect
    .poll(async () => (await noteTexts(page)).includes(text), { timeout: OPEN_TIMEOUT })
    .toBe(true);
}

/** Open the share panel the way a visitor does: the button in the header. */
async function openSharePanel(page: Page): Promise<void> {
  await page.getByTestId('share-button').click();
  await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();
}

/** Copy the board's link the way a visitor does, and hand back what was copied. */
async function copyBoardLink(page: Page): Promise<string> {
  await openSharePanel(page);
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toContainText('Link copied', { timeout: 5_000 });
  const link = await readClipboard(page);
  expect(link).toMatch(/^https?:\/\/\S+\/b\/[A-Za-z0-9_-]{22}$/);
  return link;
}

/**
 * Wait for the board itself: the canvas is drawn, the Share button is there, and
 * the connection badge is hidden — which is these tests' proof that the board's
 * content arrived (story 3's own signal).
 */
async function expectBoardOpen(page: Page): Promise<void> {
  await expect(page.getByTestId('viewport')).toBeVisible({ timeout: OPEN_TIMEOUT });
  await expect(page.getByTestId('share-button')).toBeVisible();
  await waitForConnection(page);
}

/**
 * A second, unrelated visitor: a fresh browser context with its own storage. No
 * clipboard permissions are granted here — only the test that reads the clipboard
 * back needs them, and Firefox and WebKit have none to give.
 */
async function secondVisitor(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

// ------------------------------------------------------------------ tests ----

test('TC-26 create, share, join: the link she copies is the board he opens', async (
  { browser },
  testInfo,
) => {
  // Two browsers, a board created over the network and a live edit each way.
  testInfo.setTimeout(120_000);
  const mayaContext = await browser.newContext();
  await grantClipboardPermissions(mayaContext);
  const maya = await mayaContext.newPage();

  await maya.goto(`${dev.url}/`);
  await expect(maya.getByTestId('home-page')).toBeVisible();

  // The clock the design names: from the click to a board she can draw on.
  const clickedAt = Date.now();
  await maya.getByTestId('create-board').click();
  await expectBoardOpen(maya);
  expect(Date.now() - clickedAt).toBeLessThan(OPEN_TIMEOUT);

  // The board she landed on is a real board at a real address.
  expect(maya.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  await addNote(maya, NOTE_TEXT);

  const link = await copyBoardLink(maya);
  expect(link).toBe(maya.url());

  // Sam: a separate context, with nothing shared but the text in the clipboard.
  const { context: samContext, page: sam } = await secondVisitor(browser);
  await sam.goto(link);
  await expectBoardOpen(sam);
  // The link he pasted is this board and nothing else: same address, no sign-in.
  expect(sam.url()).toBe(link);
  await expect
    .poll(async () => (await noteTexts(sam)).includes(NOTE_TEXT), { timeout: OPEN_TIMEOUT })
    .toBe(true);

  // And it is an editing link: his note reaches her, without anyone reloading.
  await addNote(sam, SAM_TEXT, 700, 500);
  // Hers updates as his note arrives, without either of them reloading.
  await expect
    .poll(async () => (await noteTexts(maya)).includes(SAM_TEXT), { timeout: OPEN_TIMEOUT })
    .toBe(true);

  await samContext.close();
  await mayaContext.close();
});

test('TC-27 bad link recovery: a link to nothing offers a board instead of a dead end', async ({
  browser,
}) => {
  // Never created, and a well-formed id, so the answer is a real 404 rather than
  // "that is not a link at all".
  const missing = newBoardId();

  const { context, page } = await secondVisitor(browser);
  await page.goto(`${dev.url}/b/${missing}`);

  await expect(page.getByTestId('board-not-found')).toBeVisible();
  await expect(page.getByText('Board not found')).toBeVisible();
  await expect(page.getByTestId('viewport')).toHaveCount(0);

  // The way out the PRD asks for: create a board from the dead end.
  await page.getByTestId('create-new-board').click();
  await expectBoardOpen(page);

  // It is a different board — empty, and at an address of its own.
  const created = /\/b\/([A-Za-z0-9_-]{22})$/.exec(page.url())?.[1] ?? '';
  expect(created).not.toBe(missing);
  expect(created).toHaveLength(22);
  expect(await noteCount(page)).toBe(0);
  await expect(page.getByTestId('board-not-found')).toHaveCount(0);

  await context.close();
});

test('TC-28 flaky service on open: the board appears when the service comes back, without a reload', async ({
  browser,
}) => {
  const boardId = await createBoard();

  const { context, page } = await secondVisitor(browser);
  // The service is down while the link is opened. The board endpoint is the only
  // thing the page asks about, so that is the request that fails.
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`${dev.url}/b/${boardId}`);

  const status = page.getByTestId('board-unreachable');
  await expect(status).toBeVisible();
  await expect(status).toContainText("Couldn't reach vidi6. Retrying…");
  await expect(page.getByTestId('viewport')).toHaveCount(0);

  // The service comes back by itself. This is the same page object — no reload was
  // issued from the test — so the board can only arrive by the page's own retry.
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('viewport')).toBeVisible({ timeout: OPEN_TIMEOUT });
  await expect(status).toHaveCount(0);

  await context.close();
});

test('TC-29 clipboard blocked: the link is shown selected, with the keystroke to press', async ({
  browser,
}) => {
  const boardId = await createBoard();

  const { context, page } = await secondVisitor(browser);
  await grantClipboardPermissions(context);
  // A visitor who denied clipboard access, or a browser that never asks for it: the
  // write itself is refused.
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
  });

  await page.goto(`${dev.url}/b/${boardId}`);
  await expectBoardOpen(page);

  await openSharePanel(page);
  await page.getByTestId('share-copy').click();

  const hint = page.getByTestId('share-manual');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Press Ctrl+C (Cmd+C on Mac) to copy');
  // The link is not lost: all of it is selected, ready for that keystroke.
  const field = await page
    .getByTestId('share-link')
    .evaluate((element: HTMLInputElement) => ({
      value: element.value,
      // A field that never had a selection reports null offsets; treat that as
      // "nothing selected" rather than letting it slip past the assertion.
      selected: element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0),
    }));
  expect(field.value).toBe(`${dev.url}/b/${boardId}`);
  expect(field.selected).toBe(field.value);
  // And the button does not claim to have copied anything.
  await expect(page.getByTestId('share-copy')).not.toContainText('Link copied');

  await context.close();
});

test('TC-30 abuse guard: the limit is reached, and the page says so in one sentence', async (
  { browser },
  testInfo,
) => {
  // Its own Worker process, so the creation budget being measured is not shared
  // with any other test in this file.
  testInfo.setTimeout(240_000);
  const own = await startDevServer();

  const { context, page } = await secondVisitor(browser);
  await page.goto(`${own.url}/`);

  // The limit is per visitor; local `wrangler dev` forwards no CF-Connecting-IP, so
  // everything from this context shares one bucket.
  for (let index = 0; index < BOARD_CREATE_LIMIT; index++) {
    await page.getByTestId('create-board').click();
    await expectBoardOpen(page);
    // Back to the home page to ask for another one.
    await page.goBack();
    await expect(page.getByTestId('home-page')).toBeVisible();
  }

  // One over the limit: refused, and explained rather than pretended away.
  await page.getByTestId('create-board').click();
  const error = page.getByTestId('home-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText("You're creating boards too quickly. Wait a minute");
  await expect(page).toHaveURL(`${own.url}/`);
  // The button is not left stuck on "Creating…".
  await expect(page.getByTestId('create-board')).toBeEnabled();

  await context.close();
  await own.dispose();
});

test('TC-31 pre-existing board: a board written before the create endpoint still opens', async ({
  browser,
}) => {
  // Seeded the way story 3 left boards on disk: rows of content, and no creation
  // marker of any kind.
  const boardId = await createBoard(legacyNoteUpdates([LEGACY_TEXT]));

  const { context, page } = await secondVisitor(browser);
  await page.goto(`${dev.url}/b/${boardId}`);

  // The board opens: it is not announced as missing just because the new endpoint
  // did not create it.
  await expectBoardOpen(page);
  await expect(page.getByTestId('board-not-found')).toHaveCount(0);
  await expect
    .poll(async () => (await noteTexts(page)).includes(LEGACY_TEXT), { timeout: OPEN_TIMEOUT })
    .toBe(true);
  // And it is shareable like any other board.
  await expect(page.getByTestId('share-button')).toBeVisible();

  await context.close();
});
