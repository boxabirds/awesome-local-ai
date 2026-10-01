import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { retroBoard25 } from '../fixtures/boards';
import { openNewBoard } from './helpers/board';
import { noteViews } from './helpers/participants';
import { createBoardAt, seedLegacyBoard } from './helpers/seed';

const notes = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Sticky note' });

test('TC-26 create, share, join: Maya creates and copies the link, Sam opens it and both edit', async ({ browser, baseURL }) => {
  const maya = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
  const mayaPage = await maya.newPage();
  await mayaPage.goto('/');
  await expect(mayaPage.getByText('A shared board for thinking together')).toBeVisible();
  const start = Date.now();
  await mayaPage.getByRole('button', { name: 'New board' }).click();
  await mayaPage.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  const ms = Date.now() - start;
  console.log(`[create] click-to-board ${ms} ms vs budget ${CREATE_BUDGET_MS} ms${ms > CREATE_BUDGET_MS ? ' (over budget, not asserted)' : ''}`);
  await expect(mayaPage.getByText('Drag to move around', { exact: false })).toBeVisible();
  await expect(notes(mayaPage)).toHaveCount(0);

  await mayaPage.mouse.dblclick(500, 400);
  await mayaPage.keyboard.type('Hello team');
  await mayaPage.keyboard.press('Escape');
  await expect(notes(mayaPage)).toHaveCount(1);

  await mayaPage.getByRole('button', { name: 'Share' }).click();
  await mayaPage.getByRole('button', { name: 'Copy link' }).click();
  await expect(mayaPage.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const link = await mayaPage.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(mayaPage.url());
  expect(link.startsWith(`${baseURL}/b/`)).toBe(true);

  const sam = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const samPage = await sam.newPage();
  await samPage.goto(link);
  await expect(notes(samPage)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(notes(samPage).first()).toContainText('Hello team');
  await expect(samPage.getByText('Board not found')).toHaveCount(0);

  // Sam edits: adds a second note; Maya sees it.
  await samPage.mouse.dblclick(900, 600);
  await samPage.keyboard.type('From Sam');
  await samPage.keyboard.press('Escape');
  await expect.poll(async () => (await noteViews(mayaPage)).map((n) => n.text).sort(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(
    expect.arrayContaining(['From Sam']),
  );
  await maya.close();
  await sam.close();
});

test('TC-27 bad link recovery: Board not found, then New board opens a fresh empty board', async ({ page }) => {
  const unknown = newBoardId();
  await page.goto(`/b/${unknown}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
  // Nothing was created at the unknown address.
  expect((await page.request.get(`/api/boards/${unknown}`)).status()).toBe(404);

  await page.getByRole('button', { name: 'New board' }).click();
  await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(new URL(page.url()).pathname).not.toBe(`/b/${unknown}`);
  await expect(notes(page)).toHaveCount(0);

  await page.goto('/b/abc');
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
});

test('TC-28 flaky service on open: retry message, then the board opens without a reload', async ({ page, baseURL }) => {
  const id = newBoardId();
  await createBoardAt(baseURL!, id);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toHaveCount(0);
});

test('TC-29 clipboard blocked: the link is selected and the manual-copy message shows', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
  });
  await openNewBoard(page);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
  const selected = await page.getByRole('textbox').evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
  expect(selected).toBe(page.url());
});

test('TC-31 pre-existing board: a legacy board still opens with its notes', async ({ page, baseURL }) => {
  const id = newBoardId();
  await seedLegacyBoard(baseURL!, id, retroBoard25().doc);
  await page.goto(`/b/${id}`);
  await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText('Board not found')).toHaveCount(0);
  await expect(notes(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
});
