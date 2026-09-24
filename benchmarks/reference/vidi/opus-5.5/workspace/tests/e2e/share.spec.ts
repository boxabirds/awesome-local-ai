/**
 * Story 5 workflows (TC-26 to TC-31) against `wrangler dev`: create, share and join; bad link
 * recovery; a flaky service while opening; clipboard blocked; the creation limit; a board saved
 * before this story.
 *
 * Board creation is limited per visitor (CF-Connecting-IP). Every test that creates boards
 * through the UI sends its own simulated visitor address (Miniflare keeps a client-supplied
 * CF-Connecting-IP), so tests running in parallel never share a creation budget.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { RETRO_NOTES, retroLog } from '../fixtures/boards';
import { editingNoteId, expectWithin, renderedNote, waitConnected } from './helpers/participants';
import { createTestBoard, seedLegacyBoard } from './helpers/seed';

const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const UNREACHABLE_TEXT = "Couldn't reach vidi6. Retrying…";
const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";
const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';
const IP_OCTET = 256;
const NOTE_POINT = { x: 640, y: 400 } as const;
const EMPTY_SPOT = { x: 200, y: 650 } as const;
const MULTI_CONTEXT_TIMEOUT_MS = 90_000;
const RATE_LIMIT_TEST_TIMEOUT_MS = 120_000;
/** The board must open after the outage within one more (capped) retry interval, plus page work. */
const RECOVERY_TIMEOUT_MS = RECONNECT_MAX_BACKOFF_MS + 5_000;
/** Outage long enough for at least one failed check and one scheduled retry. */
const OUTAGE_MS = 1_500;

function visitorIp(): string {
  const octet = () => Math.floor(Math.random() * IP_OCTET);
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** A browser context acting as one visitor (its own CF-Connecting-IP). */
async function visitor(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const { baseURL, viewport } = test.info().project.use;
  return browser.newContext({ baseURL, viewport, extraHTTPHeaders: { 'CF-Connecting-IP': visitorIp() }, ...options });
}

function boardViewport(page: Page) {
  return page.getByTestId('board-viewport');
}

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Note text' });
}

const BOARD_URL = /\/b\/[A-Za-z0-9_-]{22}$/;

test.describe('share workflows', () => {
  let contexts: BrowserContext[] = [];

  test.afterEach(async () => {
    await Promise.all(contexts.map((c) => c.close()));
    contexts = [];
  });

  test('TC-26 Create, share, join: Maya creates and copies the link; Sam opens it and both edit live', async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Clipboard read/write permissions can be granted in Chromium only');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const mayaContext = await visitor(browser, { permissions: ['clipboard-read', 'clipboard-write'] });
    const samContext = await visitor(browser);
    contexts = [mayaContext, samContext];
    const maya = await mayaContext.newPage();
    const sam = await samContext.newPage();

    await maya.goto('/');
    await expect(maya.getByRole('heading', { name: 'vidi6' })).toBeVisible();
    await expect(maya.getByText('A shared board for thinking together')).toBeVisible();
    const create = maya.getByRole('button', { name: 'Create a board' });
    const clickedAt = Date.now();
    await create.click();
    await expect(boardViewport(maya)).toBeVisible({ timeout: CREATE_BUDGET_MS });
    const openedMs = Date.now() - clickedAt;
    expect(openedMs).toBeLessThanOrEqual(CREATE_BUDGET_MS);
    await expect(maya).toHaveURL(BOARD_URL);
    // A new board is empty; story 1's hint is its empty state.
    await expect(maya.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeVisible();
    await expect(maya.getByRole('group', { name: 'Sticky note' })).toHaveCount(0);
    await waitConnected(maya);

    await maya.mouse.dblclick(NOTE_POINT.x, NOTE_POINT.y);
    await expect(editor(maya)).toBeFocused();
    const noteId = await editingNoteId(maya);
    await maya.keyboard.type('Agenda');
    await maya.keyboard.press('Escape');

    await maya.getByRole('button', { name: 'Share' }).click();
    const panel = maya.getByRole('dialog', { name: 'Share board' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Board link' })).toHaveValue(maya.url());
    await panel.getByRole('button', { name: 'Copy link' }).click();
    await expect(panel.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const copied = await maya.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(maya.url());
    expect(copied).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam pastes the link into a new browser: same board, no sign-in, editable at once.
    await sam.goto(copied);
    await expect(boardViewport(sam)).toBeVisible();
    await waitConnected(sam);
    await expect.poll(async () => (await renderedNote(sam, noteId))?.text).toBe('Agenda');
    const note = sam.locator(`[role="group"][aria-label="Sticky note"][data-id="${noteId}"]`);
    const box = await note.boundingBox();
    if (!box) throw new Error('note not rendered for Sam');
    await sam.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(editor(sam)).toBeFocused();
    await sam.keyboard.press('End');
    await sam.keyboard.type(' + actions');
    await sam.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expectWithin(async () => (await renderedNote(maya, noteId))?.text).toBe('Agenda + actions');
  });

  test('TC-27 Bad link recovery: an unknown link shows Board not found; Create a new board opens a fresh board', async ({
    browser,
  }) => {
    const context = await visitor(browser);
    contexts = [context];
    const page = await context.newPage();
    const unknown = newBoardId();
    await page.goto(`/b/${unknown}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
    await expect(boardViewport(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');

    // Nothing was created at the mistyped address.
    const check = await page.request.get(`/api/boards/${unknown}`);
    expect(check.status()).toBe(404);

    await page.getByRole('button', { name: 'Create a new board' }).click();
    await expect(boardViewport(page)).toBeVisible();
    await expect(page).toHaveURL(BOARD_URL);
    expect(page.url()).not.toContain(unknown);
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(0);
    await waitConnected(page);
  });

  test('TC-27 a malformed link shows Board not found', async ({ page }) => {
    await page.goto('/b/abc');
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  });

  test('TC-28 Flaky service on open: retry message, then the board opens without a reload', async ({
    page,
    baseURL,
  }) => {
    const boardId = await createTestBoard(baseURL!);
    await page.route('**/api/boards/*', (route) => route.abort('internetdisconnected'));
    let loads = 0;
    page.on('load', () => (loads += 1));
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText(UNREACHABLE_TEXT)).toBeVisible();
    await page.waitForTimeout(OUTAGE_MS);
    await expect(page.getByText(UNREACHABLE_TEXT)).toBeVisible();
    await page.unroute('**/api/boards/*');
    await expect(boardViewport(page)).toBeVisible({ timeout: RECOVERY_TIMEOUT_MS });
    await expect(page.getByText(UNREACHABLE_TEXT)).toHaveCount(0);
    expect(loads).toBe(1);
    await waitConnected(page);
  });

  test('TC-29 Clipboard blocked: manual-copy message and the whole link selected', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Clipboard.prototype, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')),
      });
    });
    const boardId = await createTestBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.getByRole('button', { name: 'Share' }).click();
    const panel = page.getByRole('dialog', { name: 'Share board' });
    await panel.getByRole('button', { name: 'Copy link' }).click();
    await expect(panel.getByText(MANUAL_COPY_TEXT)).toBeVisible();
    const field = panel.getByRole('textbox', { name: 'Board link' });
    await expect(field).toBeFocused();
    const selected = await field.evaluate((el: HTMLInputElement) =>
      el.value.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe(`${new URL(baseURL!).origin}/b/${boardId}`);
    await expect(panel.getByRole('button', { name: 'Link copied' })).toHaveCount(0);

    // Escape closes the panel and returns focus to Share.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
  });

  test(`TC-30 Abuse guard: creation ${BOARD_CREATE_LIMIT + 1} within a minute shows the rate-limit message`, async ({
    browser,
  }) => {
    test.setTimeout(RATE_LIMIT_TEST_TIMEOUT_MS);
    const context = await visitor(browser);
    contexts = [context];
    const page = await context.newPage();
    const created = new Set<string>();
    for (let i = 0; i < BOARD_CREATE_LIMIT; i += 1) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Create a board' }).click();
      await expect(page).toHaveURL(BOARD_URL);
      await expect(boardViewport(page)).toBeVisible();
      created.add(page.url());
    }
    expect(created.size).toBe(BOARD_CREATE_LIMIT);

    await page.goto('/');
    const button = page.getByRole('button', { name: 'Create a board' });
    await button.click();
    await expect(page.getByText(RATE_LIMITED_TEXT)).toBeVisible();
    await expect(button).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('TC-31 Pre-existing board: a board saved before sharing existed still opens with its notes', async ({
    page,
    baseURL,
  }) => {
    const boardId = newBoardId();
    await seedLegacyBoard(baseURL!, boardId, retroLog().doc);
    await page.goto(`/b/${boardId}`);
    await expect(boardViewport(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
    await waitConnected(page);
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(RETRO_NOTES);
  });
});
