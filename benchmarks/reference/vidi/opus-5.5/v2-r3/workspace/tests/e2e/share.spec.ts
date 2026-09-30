// Story 5 — share a board with a link (TC-26 to TC-29, TC-31).
// Functional waits use E2E_EVENTUAL_TIMEOUT_MS; creation time is logged against
// CREATE_BUDGET_MS, never asserted.
import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { viewport } from './helpers/board';
import { createByDoubleClick, editor, noteId, noteStates, notes } from './helpers/notes';
import { VIEWPORT, waitConnected } from './helpers/participants';
import { seedLegacyBoard } from './helpers/seed';
import { createBoardId } from './helpers/server';

const MANUAL_COPY = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

async function boardOpen(page: Page): Promise<void> {
  await expect(viewport(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => window.__vidi6 !== undefined);
  await waitConnected(page);
}

test('TC-26: create, share, join — Sam opens the copied link and both edit live', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions can only be granted in Chromium');
  const maya = await browser.newContext({ viewport: VIEWPORT, permissions: ['clipboard-read', 'clipboard-write'] });
  const sam = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await maya.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();
    await expect(page.getByText('A shared board for thinking together')).toBeVisible();

    const clickedAt = Date.now();
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(viewport(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const elapsed = Date.now() - clickedAt;
    console.log(`[share] TC-26: New board click → board visible in ${elapsed} ms (budget ${CREATE_BUDGET_MS} ms, not asserted)`);
    expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
    await boardOpen(page);
    await expect(notes(page)).toHaveCount(0);
    await expect(page.getByTestId('navigation-hint')).toBeVisible(); // story 1's empty-state hint

    const note = await createByDoubleClick(page, { x: 640, y: 400 });
    const id = await noteId(note);
    await page.keyboard.type('Agenda');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(await dialog.getByRole('textbox', { name: 'Board link' }).inputValue()).toBe(copied);

    // Sam pastes the link into a new window: same board, no sign-in, can edit.
    const samPage = await sam.newPage();
    await samPage.goto(copied);
    await boardOpen(samPage);
    await expect(samPage.locator(`[data-note-id="${id}"]`)).toContainText('Agenda', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await samPage.locator(`[data-note-id="${id}"]`).dblclick();
    await expect(editor(samPage)).toBeFocused();
    await samPage.keyboard.press('End');
    await samPage.keyboard.type(' + Sam');
    await samPage.keyboard.press('Escape');
    await expect(page.locator(`[data-note-id="${id}"]`)).toContainText('Agenda + Sam', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  } finally {
    await maya.close();
    await sam.close();
  }
});

test('TC-27: a never-created link shows Board not found; New board opens a fresh board', async ({ page, request }) => {
  const unknown = newBoardId();
  await page.goto(`/b/${unknown}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
  await expect(viewport(page)).toHaveCount(0);
  // Nothing was created at the unknown address.
  expect((await request.get(`/api/boards/${unknown}`)).status()).toBe(404);

  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).not.toHaveURL(new RegExp(unknown));
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await boardOpen(page);
  await expect(notes(page)).toHaveCount(0);
  expect((await request.get(`/api/boards/${unknown}`)).status()).toBe(404);
});

test('TC-27: a malformed link shows Board not found; the home link goes home', async ({ page }) => {
  await page.goto('/b/not-a-real-code');
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  await page.getByRole('link', { name: /home page/ }).click();
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('TC-28: while the service is unreachable the page retries and then opens the board without a reload', async ({ page }) => {
  test.setTimeout(E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS + 30_000);
  const boardId = await createBoardId();
  let aborted = 0;
  await page.route('**/api/boards/*', (route) => {
    aborted++;
    return route.abort('internetdisconnected');
  });
  await page.goto(`/b/${boardId}`);
  await expect(page.getByText(UNREACHABLE)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect.poll(() => aborted, { timeout: BOARD_CHECK_RETRY_BASE_MS * 4 }).toBeGreaterThanOrEqual(2);
  const marker = await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = Math.random()));
  await page.unroute('**/api/boards/*');
  await expect(viewport(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS });
  await expect(page.getByText(UNREACHABLE)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(marker);
});

test('TC-29: when the browser blocks the clipboard, the link is selected for manual copy', async ({ page }) => {
  await page.addInitScript(() => {
    const reject = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, 'writeText', { value: reject, configurable: true });
    } else {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: reject }, configurable: true });
    }
  });
  const boardId = await createBoardId();
  await page.goto(`/b/${boardId}`);
  await boardOpen(page);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share board' });
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByText(MANUAL_COPY)).toBeVisible();
  const expected = new URL(`/b/${boardId}`, page.url()).href;
  const selected = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return el && el.tagName === 'INPUT' ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0) : '';
  });
  expect(selected).toBe(expected);
  // Escape closes the panel.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('TC-31: a board saved before sharing existed still opens at its address', async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'storage fixture; one browser is enough');
  const boardId = newBoardId();
  await seedLegacyBoard(baseURL!, boardId, retroBoard());
  await page.goto(`/b/${boardId}`);
  await boardOpen(page);
  await expect(notes(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  expect(await noteStates(page)).toHaveLength(25);
});
