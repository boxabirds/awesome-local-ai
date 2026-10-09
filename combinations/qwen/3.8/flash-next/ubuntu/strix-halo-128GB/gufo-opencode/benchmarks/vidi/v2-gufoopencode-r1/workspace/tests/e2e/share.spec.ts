import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { createBoard, settle } from './helpers/board';

const PORT = process.env.VIDI6_E2E_PORT ?? '27616';
const ORIGIN = `http://127.0.0.1:${PORT}`;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function waitConnected(page: Page): Promise<void> {
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

function noteCount(page: Page): Promise<number> {
  return page.getByRole('group', { name: 'Sticky note' }).count();
}

async function addNote(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.getByTestId('sticky-editor').waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await settle(page);
}

test.describe('share workflows', () => {
  test('TC-26 create, share, join: a shared link opens the same board live', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions exercised in chromium');
    const mayaContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await mayaContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    const maya = await mayaContext.newPage();

    await maya.goto('/');
    const clickedAt = Date.now();
    await maya.getByTestId('new-board-button').click();
    await waitConnected(maya);
    const boardMs = Date.now() - clickedAt;
    console.log(`[budget] TC-26 click-to-board ${String(boardMs)}ms vs CREATE_BUDGET_MS ${String(CREATE_BUDGET_MS)}ms`);

    await addNote(maya, 500, 300, 'maya note');

    await maya.getByTestId('share-button').click();
    await maya.getByTestId('copy-link-button').click();
    await expect(maya.getByTestId('copy-link-button')).toHaveText('Link copied', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    const link = await maya.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await sam.goto(link);
    await waitConnected(sam);
    await expect(sam.getByText('maya note')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam edits Maya's note; the edit must reach Maya over the same board.
    await sam.getByTestId('board-viewport').click({ position: { x: 500, y: 300 } });
    const samNote = sam.getByRole('group', { name: 'Sticky note' }).first();
    await samNote.dblclick();
    await sam.keyboard.type(' sam edit');
    await sam.keyboard.press('Escape');
    await settle(sam);

    await expect
      .poll(async () => (await maya.getByText(/maya note sam edit/).count()) > 0, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(true);

    await mayaContext.close();
    await samContext.close();
  });

  test('TC-27 bad link: unknown board shows Board not found, New board opens a fresh one', async ({ page }) => {
    const missing = newBoardId();
    await page.goto(`/b/${missing}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    await page.getByTestId('new-board-button').click();
    await waitConnected(page);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  });

  test('TC-28 flaky service on open: retry message, then the board opens without reload', async ({ page, request }) => {
    const boardId = await createBoard(request);
    await page.route('**/api/boards/*', (route) => void route.abort());
    await page.goto(`/b/${boardId}`);
    await expect(page.getByRole('status')).toContainText("Couldn't reach vidi6. Retrying…", {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    await page.unroute('**/api/boards/*');
    // The retry loop (backoff from BOARD_CHECK_RETRY_BASE_MS) resolves to ready.
    await waitConnected(page);
  });

  test('TC-29 clipboard blocked: manual-copy message and full link selected', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const context: BrowserContext = await browser.newContext();
    await context.addInitScript(() => {
      const reject = (): Promise<never> => Promise.reject(new Error('clipboard blocked'));
      if (navigator.clipboard === undefined) {
        Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
      }
      Object.defineProperty(navigator.clipboard, 'writeText', { value: reject, configurable: true });
    });
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    await page.getByTestId('share-button').click();
    await page.getByTestId('copy-link-button').click();
    await expect(page.getByTestId('manual-copy-message')).toContainText('Press Ctrl+C', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    });
    const selected = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="share-link-input"]');
      if (input === null) return null;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      return input.value.slice(start, end);
    });
    expect(selected).toBe(`${ORIGIN}/b/${boardId}`);
    await context.close();
  });

  test('TC-31 pre-existing legacy board opens with its seeded notes', async ({ page, request }) => {
    const boardId = newBoardId();
    const { updates } = retroBoard();
    const response = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
      data: { updates: updates.map(toBase64) }
    });
    expect(response.ok()).toBe(true);
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
    await expect
      .poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBeGreaterThan(0);
  });
});
