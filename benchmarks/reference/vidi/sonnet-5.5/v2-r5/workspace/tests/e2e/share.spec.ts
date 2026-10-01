import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { recordUpdates } from '../fixtures/boards';
import { settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { badge, notesOf } from './helpers/participants';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test('TC-26 create, share, join', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'real clipboard permissions are Chromium-only');
  const maya = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await maya.newPage();
  await page.goto('/');
  await expect(page.getByText('A shared board for thinking together')).toBeVisible();
  const started = Date.now();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByText(HINT)).toBeVisible(EVENTUALLY);
  const took = Date.now() - started;
  console.log(`[share.create] click-to-board ${took}ms (${took <= CREATE_BUDGET_MS ? 'within' : 'OVER'} ${CREATE_BUDGET_MS}ms budget)`);
  await expect(notesOf(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0, EVENTUALLY);

  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Maya idea');
  await page.keyboard.press('Escape');
  await expect(notesOf(page).first()).toHaveText('Maya idea');

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share board' });
  await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(page.url());

  const sam = await browser.newContext();
  const samPage = await sam.newPage();
  await samPage.goto(link);
  await expect(notesOf(samPage)).toHaveCount(1, EVENTUALLY);
  await expect(notesOf(samPage).first()).toHaveText('Maya idea');
  await expect(badge(samPage)).toHaveCount(0, EVENTUALLY);
  await notesOf(samPage).first().dblclick();
  await samPage.keyboard.press('End');
  await samPage.keyboard.type(' + Sam');
  await samPage.keyboard.press('Escape');
  await expect(notesOf(page).first()).toHaveText('Maya idea + Sam', EVENTUALLY);
  await maya.close();
  await sam.close();
});

test('TC-27 bad link recovery', async ({ page, request }) => {
  const id = newBoardId();
  await page.goto(`/b/${id}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible(EVENTUALLY);
  expect((await request.get(`/api/boards/${id}`)).status()).toBe(404); // nothing was created by opening it
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByText(HINT)).toBeVisible(EVENTUALLY);
  expect(page.url()).not.toContain(id);
  await expect(notesOf(page)).toHaveCount(0);
});

test('TC-28 flaky service on open', async ({ page, request }) => {
  const id = await createBoardVia(request);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible(EVENTUALLY);
  await page.unroute('**/api/boards/*');
  await expect(page.getByText(HINT)).toBeVisible(EVENTUALLY);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toHaveCount(0);
});

test('TC-29 clipboard blocked → manual copy', async ({ page, request }) => {
  const id = await createBoardVia(request);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true,
    });
  });
  await page.goto(`/b/${id}`);
  await settled(page);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
  const selected = await page.getByRole('dialog').locator('input').evaluate((el) => {
    const i = el as HTMLInputElement;
    return i.value.slice(i.selectionStart ?? 0, i.selectionEnd ?? 0);
  });
  expect(selected).toBe(page.url());
});

test('TC-31 pre-existing board still opens', async ({ page, request }) => {
  const id = newBoardId();
  const { updates } = recordUpdates((doc) => {
    initDoc(doc);
    const noteId = createSticky(doc, { x: 100, y: 100 });
    if (noteId) getStickyText(doc, noteId)?.insert(0, 'Legacy note');
  });
  const hex = updates.map((u) => Buffer.from(u).toString('hex'));
  const seeded = await request.post(`/__test/boards/${id}/seed-legacy`, { data: hex.join(',') });
  expect(await seeded.text()).toBe('seeded');
  await page.goto(`/b/${id}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  await expect(notesOf(page)).toHaveCount(1, EVENTUALLY);
  await expect(notesOf(page).first()).toHaveText('Legacy note');
});
