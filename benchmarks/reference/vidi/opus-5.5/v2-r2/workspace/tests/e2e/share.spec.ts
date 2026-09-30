// Story 5 — share a board with a link: TC-26 to TC-29, TC-31.
// Functional waits use E2E_EVENTUAL_TIMEOUT_MS; CREATE_BUDGET_MS is logged, not asserted.
import { type Page, expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import {
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { openBoard } from './helpers/board';
import { getNotes } from './helpers/participants';
import { seedLegacyBoard } from './helpers/seed';

const BOARD_URL = /\/b\/([A-Za-z0-9_-]{22})$/;
const MANUAL_COPY = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Sticky note text' });
}

function stickyNotes(page: Page) {
  return page.getByRole('group', { name: 'Sticky note' });
}

async function waitLive(page: Page) {
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
}

function boardIdOf(page: Page): string {
  const id = BOARD_URL.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`not a board address: ${page.url()}`);
  return id;
}

test('TC-26 create, share, join: New board → Copy link → a colleague opens it and both edit live', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'clipboard read/write permissions are granted in Chromium only');
  const maya = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const sam = await browser.newContext();
  try {
    const page = await maya.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();
    await expect(page.getByText('A shared board for thinking together')).toBeVisible();
    const clickedAt = Date.now();
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const createMs = Date.now() - clickedAt;
    console.log(`[share] TC-26: click-to-board ${createMs} ms (budget ${CREATE_BUDGET_MS} ms, reported, not asserted)`);
    await expect(page).toHaveURL(BOARD_URL);
    await waitLive(page);
    // A new board is empty; story 1's hint is its empty state.
    expect(await getNotes(page)).toHaveLength(0);
    await expect(page.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom')).toBeVisible();

    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Pricing');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Anyone with this link can view and edit this board.');
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(copied).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/b\/[A-Za-z0-9_-]{22}$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Sam pastes the link: straight onto the board, no sign-in or other step.
    const samPage = await sam.newPage();
    await samPage.goto(copied);
    await waitLive(samPage);
    await expect(stickyNotes(samPage)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(stickyNotes(samPage).first()).toContainText('Pricing');

    // Sam edits the note; Maya sees it live.
    await stickyNotes(samPage).first().dblclick();
    await expect(editor(samPage)).toBeFocused();
    await editor(samPage).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await samPage.keyboard.type(' tiers');
    await samPage.keyboard.press('Escape');
    await expect(stickyNotes(page).first()).toContainText('Pricing tiers', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  } finally {
    await maya.close();
    await sam.close();
  }
});

test('TC-27 bad link recovery: an unknown link shows Board not found; New board opens a fresh board', async ({ page }) => {
  const unknown = newBoardId();
  await page.goto(`/b/${unknown}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(BOARD_URL);
  await waitLive(page);
  expect(boardIdOf(page)).not.toBe(unknown);
  expect(await getNotes(page)).toHaveLength(0);
  // Nothing was created at the unknown address.
  const check = await page.request.get(`/api/boards/${unknown}`);
  expect(check.status()).toBe(404);
});

test('TC-28 flaky service on open: retry message, then the board opens without a reload', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext();
  const created = await context.request.post('/api/boards');
  const { id } = (await created.json()) as { id: string };
  await context.close();

  await page.route('**/api/boards/*', (route) => route.abort('internetdisconnected'));
  await page.goto(`/b/${id}`);
  await page.evaluate(() => ((window as unknown as { __loadMarker: number }).__loadMarker = 7));
  await expect(page.getByText(UNREACHABLE)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.unroute('**/api/boards/*');
  await waitLive(page);
  await expect(page.getByText(UNREACHABLE)).toHaveCount(0, { timeout: RECONNECT_MAX_BACKOFF_MS });
  expect(await page.evaluate(() => (window as unknown as { __loadMarker?: number }).__loadMarker)).toBe(7);
});

test('TC-29 clipboard blocked: Copy link selects the whole link and shows the manual-copy message', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const reject = () => Promise.reject(new DOMException('Clipboard blocked', 'NotAllowedError'));
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, 'writeText', { value: reject, configurable: true });
    }
  });
  try {
    const page = await context.newPage();
    await openBoard(page);
    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByText(MANUAL_COPY)).toBeVisible();
    const link = dialog.getByRole('textbox', { name: 'Board link' });
    await expect(link).toBeFocused();
    const selected = await link.evaluate((el: HTMLInputElement) =>
      el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe(page.url());
  } finally {
    await context.close();
  }
});

test('TC-31 pre-existing board: a board saved before sharing existed still opens at its address', async ({ page, baseURL }) => {
  const id = newBoardId();
  const board = retroBoard();
  await seedLegacyBoard(baseURL!, id, board.doc);
  await page.goto(`/b/${id}`);
  await waitLive(page);
  const seeded = snapshot(board.doc);
  expect(seeded.length).toBeGreaterThan(0);
  await expect(stickyNotes(page)).toHaveCount(seeded.length, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect((await getNotes(page)).map((n) => n.id).sort()).toEqual(seeded.map((n) => n.id).sort());
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
});
