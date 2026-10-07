import { expect, test } from '@playwright/test';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { WranglerDev } from './helpers/wrangler-process';
import {
  corruptSnapshot,
  gotoBoardUrl,
  liveNoteIds,
  repairSnapshot,
  seedBoard,
  waitForSynced,
} from './helpers/persist';

/**
 * Story 4 — a damaged board fails honestly, then recovers with no reload (design
 * TC-24).
 *
 * The board is real: 25 notes synced to the room and stored. We fold it into a real
 * snapshot and scramble chunk 0 *in storage* (through the test-only `/__test` hook,
 * present only because this wrangler environment sets `TEST_HOOKS=1`), restart the
 * Worker so it must read the damaged snapshot back off disk (a warm room would just
 * serve its in-memory copy), and let a fresh client try to open the board. It must
 * show the honest load failure with editing locked — never an empty board presented
 * as fine. We then repair the bytes and prove the still-open page recovers on its
 * own, with no reload.
 */

test.describe.configure({ mode: 'single-threaded' });

test('TC-24 · a damaged board fails honestly, then recovers with no reload', async ({ browser }) => {
  const boardId = newBoardId();
  const dev = new WranglerDev('.persist-state/tc24');
  dev.clearState();
  await dev.start();
  try {
    // Make a real 25-note board, then damage its stored snapshot.
    const ctx0 = await browser.newContext();
    const seed = await ctx0.newPage();
    await gotoBoardUrl(seed, dev.url, boardId);
    await seedBoard(seed, 25);
    await waitForSynced(seed);
    expect(await liveNoteIds(seed)).toHaveLength(25);
    await ctx0.close(); // the room goes cold: nothing but storage holds the board now

    await corruptSnapshot(dev.url, boardId);

    // Restart the Worker: on its next contact it re-reads the snapshot from disk, and
    // the damage is only discovered then. (A soft reconnect would not re-read it.)
    await dev.stop();
    await dev.start();

    // A fresh browser opens the board address. The room cannot read the snapshot, so
    // it refuses to serve the board; the client shows the honest load failure.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await gotoBoardUrl(page, dev.url, boardId);
    const badge = page.getByTestId('connection-status');
    await expect(badge).toHaveText("This board couldn't be loaded. Retrying…", { timeout: 30_000 });
    await expect(badge).toHaveAttribute('data-red', 'true');
    expect(await liveNoteIds(page)).toHaveLength(0); // nothing half-loaded is presented
    await expect(page.getByTestId('create-sticky')).toBeDisabled();

    // Editing is inert while the board cannot load: double-click creates nothing.
    await page.mouse.dblclick(400, 300);
    expect(await liveNoteIds(page)).toHaveLength(0);
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);

    // The page has now lived in its current (failed) state. Mark it, so we can prove
    // the recovery below happens on *this same page* and not by reloading it.
    await page.evaluate(() => {
      (window as unknown as { __tc24_marker?: string }).__tc24_marker = 'alive';
    });

    // Repair the bytes the hook saved.
    await repairSnapshot(dev.url, boardId);

    // The client recovers on its own: the provider keeps retrying, and once past the
    // room's LOAD_RETRY_MIN_INTERVAL_MS the retry loads the repaired snapshot.
    await expect
      .poll(() => page.evaluate(() => (window as any).__vidi6.getSnapshot().length), {
        timeout: LOAD_RETRY_MIN_INTERVAL_MS + 30_000,
      })
      .toBe(25);
    await expect(page.getByTestId('connection-status')).toHaveCount(0); // badge gone
    expect(await liveNoteIds(page)).toHaveLength(25);

    // No reload happened: the marker set while the board was failing is still here.
    expect(
      await page.evaluate(() => (window as unknown as { __tc24_marker?: string }).__tc24_marker),
    ).toBe('alive');

    // The recovered board really works again: a new note appears, and the button is live.
    await page.mouse.dblclick(420, 320);
    await page.keyboard.type('recovered');
    await page.keyboard.press('Escape');
    await expect
      .poll(async () => (await liveNoteIds(page)).length, { timeout: 15_000 })
      .toBe(26);
    await expect(page.getByTestId('create-sticky')).toBeEnabled();

    await ctx.close();
  } finally {
    await dev.stop();
    dev.dispose();
  }
});
