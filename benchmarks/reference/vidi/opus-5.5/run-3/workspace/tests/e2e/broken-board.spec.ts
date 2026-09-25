// persist.client_status in a real browser: a board whose saved snapshot is damaged says so, cannot be edited,
// and appears (editable) without a reload once it can be loaded again. Uses the test-only storage hooks
// (/__test/*), which the e2e server enables with TEST_HOOKS=1.
import { expect, test, type APIRequestContext } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { notes } from './helpers/notes';
import { connectionBadge } from './helpers/participants';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

async function hook(request: APIRequestContext, boardId: string, action: string, data?: Buffer) {
  const res = await request.post(`/__test/boards/${boardId}/${action}`, data ? { data } : {});
  expect(res.status(), `${action} hook`).toBe(200);
}

test.describe('Workflow "Broken board"', () => {
  test('TC-24 honest failure message, no editing, recovery without a reload', async ({ page, request }) => {
    test.setTimeout(90_000);
    // 1. A saved 25-note board (seeding compacts it into a snapshot), then its snapshot is damaged.
    const boardId = newBoardId();
    const board = retroBoard();
    await hook(request, boardId, 'seed', Buffer.from(Y.encodeStateAsUpdate(board.doc)));
    await hook(request, boardId, 'corrupt-snapshot');

    // 2. Opened fresh: the red message, an empty board that cannot be edited.
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await page.waitForFunction(() => window.__vidi6?.notes !== undefined);
    await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
    const badge = connectionBadge(page);
    await expect(badge).toHaveText(LOAD_FAILED_TEXT);
    await expect(badge).toHaveAttribute('data-state', 'load_failed');
    expect(await badge.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(164, 22, 26)'); // red text
    const stickyButton = page.getByRole('button', { name: 'Sticky note' });
    await expect(stickyButton).toBeDisabled();
    await page.mouse.dblclick(640, 400);
    await stickyButton.click({ force: true });
    await expect(page.getByRole('textbox')).toHaveCount(0);
    expect(await notes(page)).toEqual([]);
    await expect(page.locator('[data-note-id]')).toHaveCount(0);
    // Still failing on the automatic retries.
    await page.waitForTimeout(1500);
    await expect(badge).toHaveText(LOAD_FAILED_TEXT);

    // 3. Repaired: after the retry interval the board appears by itself, and editing works again.
    await hook(request, boardId, 'repair');
    await expect(page.locator('[data-note-id]')).toHaveCount(25, {
      timeout: LOAD_RETRY_MIN_INTERVAL_MS + 2 * RECONNECT_MAX_BACKOFF_MS,
    });
    await expect(badge).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    const saved = [...(await notes(page))].sort((a, b) => (a.id < b.id ? -1 : 1));
    const expected = [...board.doc.getMap('objects').keys()].sort();
    expect(saved.map((n) => n.id)).toEqual(expected);
    await expect(stickyButton).toBeEnabled();
    await stickyButton.click();
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await expect(page.locator('[data-note-id]')).toHaveCount(26);
  });
});
