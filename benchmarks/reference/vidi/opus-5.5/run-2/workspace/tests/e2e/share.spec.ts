/**
 * Story 5 workflows (share.board_api, share.pages, share.share_panel; TC-26 to TC-31) against
 * the real `wrangler dev` Worker. Contexts that create boards through the UI send their own
 * X-Test-Visitor key (honoured only with TEST_HOOKS), so the per-visitor creation limit of
 * one test never affects another test running in parallel from the same address.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS } from '../../src/shared/config';
import { RETRO_NOTES, buildRetroBoard } from '../fixtures/boards';
import { createNoteAt, expectWithin, noteState, notes, waitConnected } from './helpers/participants';
import { TEST_VISITOR_HEADER, createBoard, newVisitor, seedLegacyBoard } from './helpers/seed';

const NOT_FOUND_HEADING = 'Board not found';
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";
const MANUAL_COPY = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const BOARD_URL = /\/b\/([A-Za-z0-9_-]{22})$/;
/** The check retries at 1 s, 2 s, 4 s...: generous time for the board to open after unroute. */
const RECOVERY_TIMEOUT_MS = 15_000;

let contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.close()));
  contexts = [];
});

async function newPage(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { [TEST_VISITOR_HEADER]: newVisitor() },
    ...options,
  });
  contexts.push(context);
  return context.newPage();
}

function boardIdOf(page: Page): string {
  const id = BOARD_URL.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error(`not on a board: ${page.url()}`);
  return id;
}

test('TC-26 create, share, join: Maya creates and shares, Sam opens the copied link and edits', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions can be granted in chromium only');
  const maya = await newPage(browser, { permissions: ['clipboard-read', 'clipboard-write'] });
  await maya.goto('/');
  await expect(maya.getByRole('heading', { name: 'vidi6' })).toBeVisible();
  await expect(maya.getByText('A shared board for thinking together')).toBeVisible();

  const clickedAt = Date.now();
  await maya.getByRole('button', { name: 'Create a board' }).click();
  await expect(maya.getByTestId('board-viewport')).toBeVisible({ timeout: CREATE_BUDGET_MS });
  const openedMs = Date.now() - clickedAt;
  console.log(`TC-26 board opened ${openedMs} ms after the click (budget ${CREATE_BUDGET_MS} ms)`);
  expect(openedMs).toBeLessThanOrEqual(CREATE_BUDGET_MS);
  expect(boardIdOf(maya)).toMatch(BOARD_ID_PATTERN);
  await expect(maya.getByTestId('navigation-hint')).toBeVisible(); // empty state
  await expect(notes(maya)).toHaveCount(0);
  await waitConnected(maya);

  const id = await createNoteAt(maya, { x: 640, y: 400 }, 'Agenda');

  await maya.getByRole('button', { name: 'Share' }).click();
  const dialog = maya.getByRole('dialog', { name: 'Share board' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Board link' })).toHaveValue(maya.url());
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const copied = await maya.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(maya.url());
  await maya.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Sam: a separate browser context, no sign-in, straight onto the board.
  const sam = await newPage(browser);
  await sam.goto(copied);
  await waitConnected(sam);
  expect(sam.url()).toBe(copied);
  await expect.poll(async () => (await noteState(sam, id))?.text).toBe('Agenda');

  // Sam edits; Maya sees it live.
  await sam.locator(`[data-id="${id}"]`).click();
  await sam.getByRole('button', { name: 'Green colour' }).click();
  await expectWithin(async () => (await noteState(maya, id))?.color, "Sam's edit on Maya's screen").toBe('green');
});

test('TC-27 bad link recovery: Board not found, then Create a new board', async ({ browser, baseURL }) => {
  const page = await newPage(browser);
  const unknown = newBoardId();
  await page.goto(`/b/${unknown}`);
  await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
  await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  await page.getByRole('button', { name: 'Create a new board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const fresh = boardIdOf(page);
  expect(fresh).not.toBe(unknown);
  await expect(page.getByTestId('navigation-hint')).toBeVisible();
  await expect(notes(page)).toHaveCount(0);

  // Nothing was created at the mistyped address.
  const res = await fetch(`${baseURL}/api/boards/${unknown}`);
  expect(res.status).toBe(404);

  // The home link works too.
  await page.goto(`/b/not-a-board`);
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page.getByRole('button', { name: 'Create a board' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('TC-28 flaky service on open: retry message, then the board opens without reload', async ({ browser, baseURL }) => {
  const boardId = await createBoard(baseURL!);
  const page = await newPage(browser);
  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });
  await page.route('**/api/boards/*', (route) => route.abort('internetdisconnected'));
  await page.goto(`/b/${boardId}`);
  await expect(page.getByText(UNREACHABLE)).toBeVisible();
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: RECOVERY_TIMEOUT_MS });
  await waitConnected(page);
  await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
  expect(navigations).toBe(1);
});

test('TC-29 clipboard blocked: manual-copy message with the full link selected', async ({ browser, baseURL }) => {
  const boardId = await createBoard(baseURL!);
  const page = await newPage(browser);
  await page.addInitScript(() => {
    const blocked = () => Promise.reject(new DOMException('Clipboard blocked', 'NotAllowedError'));
    if (navigator.clipboard !== undefined) {
      Object.defineProperty(navigator.clipboard, 'writeText', { value: blocked, configurable: true });
    } else {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: blocked }, configurable: true });
    }
  });
  await page.goto(`/b/${boardId}`);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share board' });
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByText(MANUAL_COPY)).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Board link' });
  await expect(field).toBeFocused();
  const selected = await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
  expect(selected).toBe(`${baseURL}/b/${boardId}`);
  expect(selected).toBe(page.url());
});

test(`TC-30 abuse guard: creation ${BOARD_CREATE_LIMIT + 1} within a minute shows the rate-limit message`, async ({ browser }) => {
  test.setTimeout(60_000);
  const page = await newPage(browser); // one visitor for every attempt
  for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a board' }).click();
    await expect(page).toHaveURL(BOARD_URL);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED);
  await expect(page.getByRole('button', { name: 'Create a board' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('TC-31 pre-existing board: a board saved before links were checked still opens', async ({ browser, baseURL }) => {
  const boardId = newBoardId();
  const doc = new Y.Doc();
  buildRetroBoard(doc);
  await seedLegacyBoard(baseURL!, boardId, doc);
  const page = await newPage(browser);
  await page.goto(`/b/${boardId}`);
  await expect(notes(page)).toHaveCount(RETRO_NOTES);
  await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toHaveCount(0);
  await waitConnected(page);
});
