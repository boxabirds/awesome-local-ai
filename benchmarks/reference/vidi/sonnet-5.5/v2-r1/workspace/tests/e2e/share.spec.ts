import { expect, test } from '@playwright/test';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { recordUpdates } from '../fixtures/boards';
import { createBoardId } from './helpers/board';
import { newNoteAt, noteViews, notes } from './helpers/participants';

const BASE = 'http://localhost:8787';
const eventually = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

test.describe('Share a board', () => {
  test('TC-26 create, share, join', async ({ browser }) => {
    const maya = await browser.newContext({
      baseURL: BASE,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const mayaPage = await maya.newPage();
    await mayaPage.goto('/');
    await expect(mayaPage.getByText('A shared board for thinking together')).toBeVisible();
    const started = Date.now();
    await mayaPage.getByRole('button', { name: 'New board' }).click();
    await mayaPage.getByTestId('board-viewport').waitFor();
    await expect(mayaPage.getByText('Opening board…')).toHaveCount(0);
    const ms = Date.now() - started;
    console.log(`[create] click to board: ${ms} ms (budget ${CREATE_BUDGET_MS} ms${ms > CREATE_BUDGET_MS ? ', OVER' : ''})`);
    expect(await notes(mayaPage).count()).toBe(0);
    await expect(mayaPage).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);

    await mayaPage.waitForFunction(() => document.querySelector('[data-testid="board-viewport"]') !== null);
    const noteId = await newNoteAt(mayaPage, 500, 350);
    await mayaPage.keyboard.type('from Maya');
    await mayaPage.keyboard.press('Escape');

    await mayaPage.getByRole('button', { name: 'Share' }).click();
    const dialog = mayaPage.getByRole('dialog', { name: 'Share board' });
    await expect(dialog.getByText('Anyone with this link can view and edit this board.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('button', { name: 'Link copied' })).toBeVisible();
    const link = await mayaPage.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(mayaPage.url());

    const sam = await browser.newContext({ baseURL: BASE });
    const samPage = await sam.newPage();
    await samPage.goto(link);
    await samPage.getByTestId('board-viewport').waitFor();
    await expect.poll(async () => (await noteViews(samPage)).map((n) => n.text), eventually).toEqual(['from Maya']);

    await samPage.locator(`[data-note-id="${noteId}"]`).dblclick();
    await samPage.keyboard.press('End');
    await samPage.keyboard.type(' + Sam');
    await expect.poll(async () => (await noteViews(mayaPage)).map((n) => n.text), eventually).toEqual(['from Maya + Sam']);

    await maya.close();
    await sam.close();
  });

  test('TC-27 bad link recovery', async ({ page }) => {
    const id = newBoardId();
    const probe = await page.request.get(`/api/boards/${id}`);
    expect(probe.status()).toBe(404);
    await page.goto(`/b/${id}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
    expect((await page.request.get(`/api/boards/${id}`)).status()).toBe(404); // nothing was created

    await page.getByRole('button', { name: 'New board' }).click();
    await page.getByTestId('board-viewport').waitFor();
    expect(page.url()).not.toContain(id);
    expect(await notes(page).count()).toBe(0);
  });

  test('malformed link shows Board not found', async ({ page }) => {
    await page.goto('/b/abc');
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  });

  test('TC-28 flaky service on open', async ({ page }) => {
    const id = await createBoardId(BASE);
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${id}`);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
    await page.unroute('**/api/boards/*');
    await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toHaveCount(0);
  });

  test('TC-29 clipboard blocked shows the manual-copy fallback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
        configurable: true,
      });
    });
    const id = await createBoardId(BASE);
    await page.goto(`/b/${id}`);
    await page.getByTestId('board-viewport').waitFor();
    await page.getByRole('button', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
    const selected = await page.evaluate(() => {
      const el = document.querySelector('.share-link') as HTMLInputElement;
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    });
    expect(selected).toBe(`${BASE}/b/${id}`);
  });

  test('TC-31 pre-existing board still opens', async ({ page, request }) => {
    const id = newBoardId();
    const { updates } = recordUpdates((doc) => {
      const noteId = createSticky(doc, { x: 100, y: 100 }) as string;
      getStickyText(doc, noteId)?.insert(0, 'legacy note');
    });
    const merged = await import('yjs').then((Y) => Y.mergeUpdates(updates));
    const seeded = await request.post(`/__test/boards/${id}/seed-legacy`, { data: Buffer.from(merged) });
    expect(seeded.status()).toBe(204);
    await page.goto(`/b/${id}`);
    await page.getByTestId('board-viewport').waitFor();
    await expect.poll(async () => (await noteViews(page)).map((n) => n.text), eventually).toEqual(['legacy note']);
  });
});
