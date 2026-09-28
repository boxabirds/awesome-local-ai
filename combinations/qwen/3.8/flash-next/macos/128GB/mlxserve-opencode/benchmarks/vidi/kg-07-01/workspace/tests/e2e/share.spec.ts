// share.* end to end against `wrangler dev`: home page creation, the Share panel, opening links, Board not found,
// an unreachable service, the creation limit and pre-existing (legacy) boards.
//
// Creation is rate limited per visitor (CF-Connecting-IP). Every test sends its own made-up visitor address,
// so tests running in parallel (and in several browsers) never share a limit.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_BUDGET_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { createBoard, randomVisitorIp } from './helpers/boards-api';
import { createByDoubleClick, noteById, notes } from './helpers/notes';
import { waitConnected } from './helpers/participants';

const MANUAL_COPY = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";
const BOARD_URL = /\/b\/[A-Za-z0-9_-]{22}$/;

async function asVisitor(context: BrowserContext, ip = randomVisitorIp()) {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': ip });
}

async function createFromHome(page: Page) {
  await page.goto('/');
  await expect(page.getByText('A shared board for thinking together')).toBeVisible();
  await page.getByRole('button', { name: 'Create a board' }).click();
}

function linkField(page: Page) {
  return page.getByRole('dialog', { name: 'Share board' }).getByRole('textbox', { name: 'Board link' });
}

test.describe('Workflow "Create, share, join"', () => {
  test('TC-26 Maya creates a board and copies its link; Sam opens it and both edit live', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'reading the real clipboard needs Chromium clipboard permissions');
    test.setTimeout(60_000);
    const mayaContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await asVisitor(mayaContext);
    const maya = await mayaContext.newPage();
    await maya.goto('/');
    await expect(maya.getByRole('heading', { name: 'vidi6' })).toBeVisible();

    const clickedAt = Date.now();
    await maya.getByRole('button', { name: 'Create a board' }).click();
    await expect(maya.getByTestId('board-viewport')).toBeVisible({ timeout: CREATE_BUDGET_MS });
    expect(Date.now() - clickedAt).toBeLessThanOrEqual(CREATE_BUDGET_MS);
    await expect(maya).toHaveURL(BOARD_URL);
    await expect(maya.getByTestId('navigation-hint')).toBeVisible();
    await waitConnected(maya);

    const noteId = await createByDoubleClick(maya, { x: 500, y: 400 });
    await maya.keyboard.type('Offsite agenda');
    await maya.keyboard.press('Escape');

    await maya.getByRole('button', { name: 'Share' }).click();
    const dialog = maya.getByRole('dialog', { name: 'Share board' });
    await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const copied = await maya.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(maya.url());
    expect(copied).toMatch(/^http:\/\/localhost:\d+\/b\/[A-Za-z0-9_-]{22}$/);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible({ timeout: 5000 });

    // Sam pastes the link into a new browser window: straight onto the board, no other step.
    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await sam.goto(copied);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    await waitConnected(sam);
    await expect(noteById(sam, noteId)).toContainText('Offsite agenda');

    await noteById(sam, noteId).dblclick();
    await expect(sam.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await sam.keyboard.press('End');
    await sam.keyboard.type(' + dinner');
    await sam.keyboard.press('Escape');
    await expect(noteById(maya, noteId)).toContainText('Offsite agenda + dinner');
    await Promise.all([mayaContext.close(), samContext.close()]);
  });
});

test.describe('Workflow "Bad link recovery"', () => {
  test('TC-27 a link to a board that was never created shows Board not found; Create a new board recovers', async ({
    page,
  }) => {
    await asVisitor(page.context());
    const unknown = newBoardId();
    await page.goto(`/b/${unknown}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
    await expect(page.getByTestId('board-viewport')).toHaveCount(0);
    // Nothing was created at the unknown address.
    expect((await page.request.get(`/api/boards/${unknown}`)).status()).toBe(404);

    await page.getByRole('button', { name: 'Create a new board' }).click();
    await expect(page).not.toHaveURL(new RegExp(unknown));
    await expect(page).toHaveURL(BOARD_URL);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitConnected(page);
    expect(await notes(page)).toEqual([]);
  });

  test('a malformed link shows Board not found; the home link goes home', async ({ page }) => {
    await page.goto('/b/not-a-board');
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Create a board' })).toBeVisible();
  });
});

test.describe('Workflow "Flaky service on open"', () => {
  test('TC-28 while the link cannot be checked it says so and retries; the board opens without a reload', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'request routing behaviour is the same in every engine; run once');
    const boardId = await createBoard(page.request);
    await page.route('**/api/boards/*', (route) => route.abort('internetdisconnected'));
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText(UNREACHABLE)).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
    await page.unroute('**/api/boards/*');
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  });
});

test.describe('Workflow "Clipboard blocked"', () => {
  test('TC-29 when the browser refuses the copy, the whole link is selected with the manual-copy hint', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) },
      });
    });
    const boardId = await createBoard(page.request);
    await page.goto(`/b/${boardId}`);
    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByText(MANUAL_COPY)).toBeVisible();

    const field = linkField(page);
    await expect(field).toBeFocused();
    const selected = await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
    expect(selected).toBe(page.url());
    expect(selected).toMatch(new RegExp(`/b/${boardId}$`));

    // Escape closes the panel.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
  });
});

test.describe('Workflow "Abuse guard"', () => {
  test('TC-30 the creation after BOARD_CREATE_LIMIT within the period is refused with the rate-limit message', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'server-side limit; run once');
    test.setTimeout(120_000);
    // The local limiter uses fixed windows aligned to the clock: start with at least 40 s of the window left.
    const period = BOARD_CREATE_PERIOD_SECONDS * 1000;
    const left = period - (Date.now() % period);
    if (left < 40_000) await page.waitForTimeout(left + 500);

    await asVisitor(page.context());
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      await createFromHome(page);
      await expect(page, `creation ${i + 1}`).toHaveURL(BOARD_URL);
      await page.goBack();
    }
    await createFromHome(page);
    await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED);
    await expect(page.getByRole('button', { name: 'Create a board' })).toBeEnabled();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Workflow "Pre-existing board"', () => {
  test('TC-31 a board saved before board creation existed still opens with its notes', async ({ page, request }) => {
    const boardId = newBoardId();
    const board = retroBoard();
    const seeded = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
      data: Buffer.from(Y.encodeStateAsUpdate(board.doc)),
    });
    expect(seeded.status()).toBe(200);

    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
    await waitConnected(page);
    await expect(page.locator('[data-note-id]')).toHaveCount(snapshot(board.doc).length);
  });
});
