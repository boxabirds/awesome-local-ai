import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { setCamera } from './helpers/board';
import { createBoardId } from './helpers/create';
import { boardSnapshot, expectEventually, notesOf } from './helpers/participants';

const HINT = 'Drag to move around';
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

async function waitConnected(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  }).toBe('connected');
}

test('TC-26: create, share, join - Maya creates a board and Sam joins from the copied link', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'real clipboard needs Chromium permissions');
  const maya = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
  const mayaPage = await maya.newPage();
  await mayaPage.goto('/');
  await expect(mayaPage.getByText('A shared board for thinking together')).toBeVisible();

  const clickedAt = Date.now();
  await mayaPage.getByRole('button', { name: 'New board' }).click();
  await expect(mayaPage.getByText(HINT)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  const ms = Date.now() - clickedAt;
  console.log(`[create] click-to-board: ${ms} ms (budget ${CREATE_BUDGET_MS} ms${ms > CREATE_BUDGET_MS ? ', OVER' : ''})`);
  await expect(notesOf(mayaPage)).toHaveCount(0);
  await waitConnected(mayaPage);
  await setCamera(mayaPage, 0, 0, 1);

  await mayaPage.mouse.dblclick(400, 300);
  await mayaPage.keyboard.type('Maya idea');
  await mayaPage.mouse.click(900, 600);

  await mayaPage.getByRole('button', { name: 'Share' }).click();
  const dialog = mayaPage.getByRole('dialog', { name: 'Share board' });
  await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const link = await mayaPage.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(mayaPage.url());
  expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

  const sam = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const samPage = await sam.newPage();
  await samPage.goto(link);
  await waitConnected(samPage);
  await setCamera(samPage, 0, 0, 1);
  await expectEventually('sam sees note', () => boardSnapshot(samPage).then((s) => s.map((n) => n.text)), ['Maya idea']);

  await samPage.mouse.dblclick(700, 400);
  await samPage.keyboard.type('From Sam');
  await expectEventually('maya sees sam edit', () => boardSnapshot(mayaPage).then((s) => s.map((n) => n.text).sort()),
    ['From Sam', 'Maya idea']);
  await maya.close();
  await sam.close();
});

test('TC-27: bad link recovery - unknown link shows Board not found; New board opens a fresh board', async ({ page, request }) => {
  const unknown = newBoardId();
  await page.goto(`/b/${unknown}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByText(HINT)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(page.url()).not.toContain(unknown);
  await expect(notesOf(page)).toHaveCount(0);
  // Nothing was created at the mistyped address.
  expect((await request.get(`/api/boards/${unknown}`)).status()).toBe(404);
});

test('TC-28: flaky service on open - retry message, then the board opens without a reload', async ({ page }) => {
  const id = await createBoardId();
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
  await page.unroute('**/api/boards/*');
  await expect(page.getByText(HINT)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
});

test('TC-29: clipboard blocked - manual copy message with the full link selected', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true,
    });
  });
  await page.goto(`/b/${await createBoardId()}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText(MANUAL)).toBeVisible();
  const selected = await page.getByRole('textbox').evaluate((el) => {
    const input = el as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  });
  expect(selected).toBe(page.url());
});

test('TC-31: a pre-existing board (saved content, no created_at) still opens with its notes', async ({ page, request }) => {
  const id = newBoardId();
  const updates = retroBoard().updates.map((u) => Buffer.from(u).toString('base64'));
  const seeded = await request.post(`/__test/boards/${id}/seed-legacy`, { data: updates });
  expect(seeded.ok()).toBe(true);
  await page.goto(`/b/${id}`);
  await waitConnected(page);
  await setCamera(page, 0, 0, 0.5);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  await expect(notesOf(page)).toHaveCount(25);
});
