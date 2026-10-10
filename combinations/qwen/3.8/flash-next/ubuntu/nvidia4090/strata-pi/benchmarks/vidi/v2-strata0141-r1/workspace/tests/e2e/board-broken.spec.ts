import { test, expect } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { openBoard } from './helpers/board';
import { badgeText, connectionState, waitForBoardConnection } from './helpers/live';
import { createNoteAt, getNotes } from './helpers/sticky';
import { callHook } from './helpers/wrangler-process';
import type { Page } from '@playwright/test';

/**
 * Story 4 end-to-end: a board that cannot be read says so (task: E2E broken
 * board).
 *
 * This runs against Playwright's own `wrangler dev` (which carries TEST_HOOKS in
 * the test build): the board is snapshotted, the snapshot is damaged through the
 * storage test hook, and the room then lets go of the board it was holding, so
 * the next visitor meets the damage. After the repair hook the page has to
 * recover by itself - no reload.
 */

const BASE = `http://127.0.0.1:${Number(process.env.VIDI6_E2E_PORT ?? 24064)}`;

/** How long the client may take to try again: the room retries no faster than
 * LOAD_RETRY_MIN_INTERVAL_MS apart, and the client backs off between tries. */
const RECOVERY_TIMEOUT_MS = 90_000;

async function boardEditable(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const main = document.querySelector('main[data-board-editable]');
    return main ? main.getAttribute('data-board-editable') === 'true' : null;
  });
}

test.describe('a board that cannot be loaded', () => {
  test('TC-24: honest failure, editing locked, recovery without a reload', async ({ browser }) => {
    test.setTimeout(240_000);

    // A board with one note, put into a snapshot, then damaged.
    const setup = await browser.newContext();
    const page = await setup.newPage();
    const board = await openBoard(page);
    await waitForBoardConnection(page);
    await page.evaluate(() => {
      const api = (window as unknown as {
        __vidi6?: { createNote(params: { at: { x: number; y: number }; text: string }): string };
      }).__vidi6;
      api?.createNote({ at: { x: -200, y: 100 }, text: 'the note that was already saved' });
    });
    await expect
      .poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);

    expect((await callHook({ url: BASE }, board, 'compact')).ok).toBe(true);
    expect((await callHook({ url: BASE }, board, 'corrupt-snapshot')).ok).toBe(true);
    await setup.close();

    // A visitor arrives and finds a board that cannot be read.
    const visitor = await browser.newContext();
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(`/b/${board}`);
    await visitorPage.waitForSelector('[data-testid="board"]');
    await visitorPage.evaluate(() => {
      (window as unknown as { __tc24_marker?: number }).__tc24_marker = Date.now();
    });

    await expect(visitorPage.getByTestId('connection-status')).toHaveText(/couldn't be loaded/, {
      timeout: 20_000,
    });
    await expect.poll(async () => await badgeText(visitorPage), { timeout: 20_000 }).toContain(
      "couldn't be loaded",
    );

    // The badge is the danger tone, and the board is locked.
    await expect(visitorPage.getByTestId('connection-status')).toHaveAttribute(
      'data-tone',
      'danger',
    );
    await expect.poll(async () => await boardEditable(visitorPage)).toBe(false);
    expect(await visitorPage.locator('[data-testid^="sticky-note-"]').count()).toBe(0);

    // Every way in to a mutation is closed: double-clicking the board creates
    // nothing, and the toolbar button is disabled.
    await visitorPage.dblclick('[data-testid="board"]');
    expect(await visitorPage.locator('[data-testid^="sticky-note-"]').count()).toBe(0);
    await expect(visitorPage.getByTestId('create-sticky')).toBeDisabled();

    // Fix the snapshot. The page is still open, still retrying on its own.
    expect((await callHook({ url: BASE }, board, 'repair')).ok).toBe(true);

    await expect
      .poll(async () => await connectionState(visitorPage), {
        timeout: RECOVERY_TIMEOUT_MS,
        message: 'the board never came back',
      })
      .toBe('connected');
    await expect.poll(async () => await boardEditable(visitorPage)).toBe(true);
    await expect
      .poll(async () => (await getNotes(visitorPage)).map((note) => note.text), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toEqual(['the note that was already saved']);

    // Same page, not a reloaded one.
    expect(
      await visitorPage.evaluate(() => (window as unknown as { __tc24_marker?: number }).__tc24_marker),
    ).not.toBeNull();

    // Editing works again.
    await createNoteAt(visitorPage, { x: 300, y: 0 }, 'blue');
    expect((await getNotes(visitorPage)).length).toBe(2);

    await visitor.close();
  });
});
