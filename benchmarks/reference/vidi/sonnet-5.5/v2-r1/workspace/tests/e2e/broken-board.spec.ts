import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { retroBoard } from '../fixtures/boards';
import { notes } from './helpers/participants';

const MESSAGE = "This board couldn't be loaded. Retrying…";

test.describe('Broken board', () => {
  test('TC-24 honest failure, edit lock, recovery without reload', async ({ page, request, baseURL }) => {
    const boardId = newBoardId();
    const wsUrl = `${(baseURL ?? '').replace('http', 'ws')}/api/rooms`;
    const doc = new Y.Doc();
    initDoc(doc);
    retroBoard(doc);
    const seeder = new WebsocketProvider(wsUrl, boardId, doc, { WebSocketPolyfill: WebSocket as never, disableBc: true });
    const checkDoc = new Y.Doc();
    const checker = new WebsocketProvider(wsUrl, boardId, checkDoc, { WebSocketPolyfill: WebSocket as never, disableBc: true });
    try {
      await expect.poll(() => snapshot(checkDoc).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
    } finally {
      seeder.destroy();
      checker.destroy();
    }

    expect((await request.post(`/__test/boards/${boardId}/corrupt-snapshot`)).status()).toBe(204);

    await page.goto(`/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor();
    const badge = page.getByText(MESSAGE);
    await expect(badge).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(badge).toHaveCSS('color', 'rgb(153, 27, 27)');
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();
    await page.mouse.dblclick(600, 400);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(notes(page)).toHaveCount(0); // never an empty editable board

    expect((await request.post(`/__test/boards/${boardId}/repair`)).status()).toBe(204);
    await page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 500);

    await expect(notes(page)).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 });
    await expect(badge).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(notes(page)).toHaveCount(26);
  });
});
