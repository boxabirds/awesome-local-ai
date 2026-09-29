// persist.client_status end to end: a board whose saved snapshot is damaged (test hook) is shown
// as broken, cannot be edited, and appears without a reload once it is repaired.
import { expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LOAD_RETRY_MIN_INTERVAL_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { retroBoard } from '../fixtures/boards';
import { getNotes, notes } from './helpers/board';
import { connectionBadge, connectionState } from './helpers/participants';
import { createBoardViaApi, seedBoard } from './helpers/seed';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
// The next retry comes within the provider's longest backoff; the room reloads at most every
// LOAD_RETRY_MIN_INTERVAL_MS.
const RECOVERY_TIMEOUT_MS = E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS + LOAD_RETRY_MIN_INTERVAL_MS;

test.describe('Workflow: Broken board', () => {
  test('TC-24 honest failure, editing blocked, recovery without reload', async ({ page, request, baseURL }, testInfo) => {
    testInfo.setTimeout(RECOVERY_TIMEOUT_MS + 60_000);
    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, retroBoard().updates);
    // Compacts the board into a snapshot, damages it and reloads the room.
    const corrupt = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
    expect(corrupt.status(), await corrupt.text()).toBe(200);

    await page.goto(`/b/${boardId}`);
    await expect(connectionBadge(page)).toHaveText(LOAD_FAILED_TEXT, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(connectionBadge(page)).toHaveAttribute('data-state', 'load_failed');
    const colour = await connectionBadge(page).evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = colour.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g + 50); // red text
    expect(r).toBeGreaterThan(b + 50);
    await page.evaluate(() => ((window as unknown as { __notReloaded: boolean }).__notReloaded = true));

    // Nothing can be created: double-click on the board, the (disabled) Sticky note button.
    await page.mouse.dblclick(640, 400);
    const button = page.getByRole('button', { name: 'Sticky note' });
    await expect(button).toBeDisabled();
    await button.click({ force: true });
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    expect(await getNotes(page)).toEqual([]);
    await expect(notes(page)).toHaveCount(0);
    expect(await connectionState(page)).toBe('load_failed');

    const repair = await request.post(`/__test/boards/${boardId}/repair`);
    expect(repair.status(), await repair.text()).toBe(200);
    const repairedAt = Date.now();
    await expect(notes(page)).toHaveCount(25, { timeout: RECOVERY_TIMEOUT_MS });
    console.log(`TC-24: board appeared ${Date.now() - repairedAt} ms after the repair`);
    await expect(connectionBadge(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __notReloaded?: boolean }).__notReloaded)).toBe(true);

    await expect(button).toBeEnabled();
    await button.click();
    await expect(notes(page)).toHaveCount(26);
  });
});
