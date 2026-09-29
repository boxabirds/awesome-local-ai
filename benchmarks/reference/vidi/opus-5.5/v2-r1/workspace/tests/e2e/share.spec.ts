// share.board_api + share.pages + share.share_panel end to end against `wrangler dev`.
// Functional waits use E2E_EVENTUAL_TIMEOUT_MS; wall-clock budgets are logged, not asserted.
import { type Page, expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { retroBoard } from '../fixtures/boards';
import { boxOf, centreOf, getNotes, noteEditor, notes, originMarker } from './helpers/board';
import { waitForConnected } from './helpers/participants';
import { createBoardViaApi, seedLegacyBoard } from './helpers/seed';

const BOARD_URL = /\/b\/[A-Za-z0-9_-]{22}$/;
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

const shareButton = (page: Page) => page.getByRole('button', { name: 'Share' });
const sharePanel = (page: Page) => page.getByRole('dialog', { name: 'Share board' });

async function expectEmptyBoard(page: Page) {
  await expect(originMarker(page)).toBeAttached({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await waitForConnected(page);
  expect(await getNotes(page)).toEqual([]);
  await expect(page.getByText('Board not found')).toHaveCount(0);
}

/** The text selected in the focused input. */
function selectedInputText(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    if (!el || el.tagName !== 'INPUT') return null;
    return el.value.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  });
}

test.describe('Workflow: Create, share, join', () => {
  test('TC-26 Maya creates a board and copies its link; Sam opens it and both edit live', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions can be granted in Chromium only');
    const { baseURL, viewport } = testInfo.project.use;
    const maya = await browser.newContext({ baseURL, viewport });
    await maya.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sam = await browser.newContext({ baseURL, viewport });
    try {
      const page = await maya.newPage();
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();
      await expect(page.getByText('A shared board for thinking together')).toBeVisible();

      const clicked = Date.now();
      await page.getByRole('button', { name: 'New board' }).click();
      await expect(originMarker(page)).toBeAttached({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const ms = Date.now() - clicked;
      console.log(
        `TC-26: new board shown ${ms} ms after clicking New board ` +
          `(budget ${CREATE_BUDGET_MS} ms, reported not asserted${ms > CREATE_BUDGET_MS ? '; OVER BUDGET' : ''})`,
      );
      await expect(page).toHaveURL(BOARD_URL);
      await expectEmptyBoard(page);

      // A note, then Share → Copy link.
      await page.mouse.dblclick(500, 400);
      await expect(noteEditor(page)).toBeFocused();
      await page.keyboard.type('Agenda');
      await page.keyboard.press('Escape');

      await shareButton(page).click();
      await expect(sharePanel(page)).toBeVisible();
      await expect(sharePanel(page)).toContainText('Anyone with this link can view and edit this board.');
      await sharePanel(page).getByRole('button', { name: 'Copy link' }).click();
      await expect(sharePanel(page).getByRole('button', { name: 'Link copied' })).toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toBe(page.url());
      expect(link).toMatch(new RegExp(`^${baseURL}/b/[A-Za-z0-9_-]{22}$`));
      await expect(sharePanel(page).getByRole('textbox', { name: 'Board link' })).toHaveValue(link);
      await page.keyboard.press('Escape');
      await expect(sharePanel(page)).toHaveCount(0);

      // Sam pastes the link into a fresh browser: same board, no other step.
      const samPage = await sam.newPage();
      await samPage.goto(link);
      await waitForConnected(samPage);
      await expect(notes(samPage)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(notes(samPage).first()).toContainText('Agenda');

      // Sam edits it; Maya sees the edit.
      const at = centreOf(await boxOf(notes(samPage).first()));
      await samPage.mouse.dblclick(at.x, at.y);
      await expect(noteEditor(samPage)).toBeFocused();
      await samPage.keyboard.press('End');
      await samPage.keyboard.type(' by Sam');
      await expect
        .poll(async () => (await getNotes(page)).map((n) => n.text), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toEqual(['Agenda by Sam']);
    } finally {
      await Promise.all([maya.close(), sam.close()]);
    }
  });
});

test.describe('Workflow: Bad link recovery', () => {
  test('TC-27 a never-created link shows Board not found; New board opens a fresh board', async ({
    page,
    request,
  }) => {
    const unknown = newBoardId();
    await page.goto(`/b/${unknown}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(
      page.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /home page/ })).toHaveAttribute('href', '/');
    await expect(originMarker(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page).not.toHaveURL(new RegExp(unknown));
    await expect(page).toHaveURL(BOARD_URL);
    await expectEmptyBoard(page);

    // Nothing was created at the unknown link.
    expect((await request.get(`/api/boards/${unknown}`)).status()).toBe(404);
  });

  test('a malformed link and an unknown address show Board not found', async ({ page }) => {
    for (const path of ['/b/abc', '/b/not-a-real-board-link-at-all', '/somewhere']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    }
    await page.getByRole('link', { name: /home page/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  });
});

test.describe('Workflow: Flaky service on open', () => {
  test('TC-28 the link check retries while unreachable, then the board opens without a reload', async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium only (as designed)');
    const boardId = await createBoardViaApi(baseURL!);
    let aborted = 0;
    await page.route('**/api/boards/*', (route) => {
      aborted += 1;
      return route.abort('internetdisconnected');
    });
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await page.evaluate(() => ((window as unknown as { __notReloaded: boolean }).__notReloaded = true));
    await expect.poll(() => aborted, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeGreaterThanOrEqual(2);

    await page.unroute('**/api/boards/*');
    await expect(originMarker(page)).toBeAttached({
      timeout: E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS,
    });
    await waitForConnected(page);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);
  });
});

test.describe('Workflow: Clipboard blocked', () => {
  test('TC-29 a rejected clipboard write selects the full link for manual copying', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('blocked', 'NotAllowedError')) },
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page).toHaveURL(BOARD_URL);
    await shareButton(page).click();
    await sharePanel(page).getByRole('button', { name: 'Copy link' }).click();

    await expect(sharePanel(page).getByText(MANUAL)).toBeVisible();
    await expect(sharePanel(page).getByRole('textbox', { name: 'Board link' })).toBeFocused();
    expect(await selectedInputText(page)).toBe(page.url());
    await expect(sharePanel(page).getByRole('button', { name: 'Link copied' })).toHaveCount(0);

    // A click outside closes the panel.
    await page.mouse.click(640, 700);
    await expect(sharePanel(page)).toHaveCount(0);
  });
});

test.describe('Workflow: Pre-existing board', () => {
  test('TC-31 a board saved before links were created explicitly still opens', async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium only (as designed)');
    const boardId = newBoardId();
    const board = retroBoard();
    await seedLegacyBoard(baseURL!, boardId, Y.mergeUpdates(board.updates));

    await page.goto(`/b/${boardId}`);
    await expect(notes(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.getByText('Board not found')).toHaveCount(0);
    const shown = await getNotes(page);
    expect(shown.map(({ id, text, color, x, y }) => ({ id, text, color, x, y }))).toEqual(
      snapshot(board.doc).map(({ id, text, color, x, y }) => ({ id, text, color, x, y })),
    );
  });
});
