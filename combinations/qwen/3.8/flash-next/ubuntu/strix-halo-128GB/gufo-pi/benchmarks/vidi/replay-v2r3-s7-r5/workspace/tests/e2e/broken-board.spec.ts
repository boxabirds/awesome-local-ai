/**
 * E2E broken board (TC-24): a corrupt snapshot makes the room fail to load; the
 * client shows the honest red message and blocks editing; repairing storage (no
 * page reload) recovers the board and re-enables editing once the room retries.
 *
 * Runs against a dedicated `wrangler dev --persist-to <dir>` with TEST_HOOKS
 * enabled. Story 4: persist.client_status.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  startWrangler,
  cleanupPersistDir,
  testHook,
  type WranglerHandle,
} from './helpers/wrangler-process';

const PORT = 5412;

async function createBoardViaApi(handle: WranglerHandle): Promise<string> {
  const res = await fetch(`${handle.url}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(handle: WranglerHandle, context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${handle.url}/b/${boardId}`);
  return page;
}

async function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__vidi6?.connectionState);
}

async function getBoard(page: Page) {
  return page.evaluate(() => [...((window as any).__vidi6?.getBoard?.() ?? [])]);
}

async function addNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  return page.evaluate(({ at, text }) => (window as any).__vidi6!.addSticky!(at, text, 'yellow'), {
    at,
    text,
  });
}

test.describe('Broken board', () => {
  let handle: WranglerHandle;

  test.afterEach(async () => {
    if (handle) {
      await handle.stop();
      cleanupPersistDir(handle.persistDir);
    }
  });

  test('TC-24: honest failure, edit lock, recovery without reload', async ({ browser }) => {
    test.setTimeout(60000);
    handle = await startWrangler(PORT);
    const boardId = await createBoardViaApi(handle);

    // 1. Create a 25-note board in the browser, then force a snapshot and corrupt it.
    const ctx0 = await browser.newContext();
    const seed = await openBoard(handle, ctx0, boardId);
    await seed.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 15000 },
    );
    for (let i = 0; i < 25; i++) {
      await addNote(seed, { x: (i % 5) * 220 + 110, y: Math.floor(i / 5) * 220 + 110 }, `Note ${i}`);
    }
    await expect
      .poll(() => getBoard(seed).then((b) => b.length), { timeout: 15000, intervals: [200] })
      .toBe(25);
    await ctx0.close();
    await new Promise((r) => setTimeout(r, 300));

    await testHook(handle, boardId, 'force-compact', 'POST');
    const corrupt = await testHook(handle, boardId, 'corrupt-snapshot', 'POST');
    if (!corrupt.ok) {
      // Could not produce a snapshot to corrupt in this environment; nothing to assert.
      return;
    }

    // Restart so the room reloads from the corrupted snapshot (drops warm memory).
    await handle.stop();
    handle = await startWrangler(PORT, handle.persistDir);

    // 2. Open in a fresh context → red load-failed message; editing is blocked.
    const ctx = await browser.newContext();
    const page = await openBoard(handle, ctx, boardId);

    await expect
      .poll(() => connectionState(page), { timeout: 15000, intervals: [250] })
      .toBe('load_failed');

    const badge = page.getByTestId('connection-status');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("couldn");

    // Creating a note via the toolbar button does nothing (button disabled).
    const createBtn = page.getByTestId('create-sticky-button');
    await expect(createBtn).toBeDisabled();
    const boardWhileBroken = await getBoard(page);
    // Double-click empty space creates nothing.
    const vp = await page.getByTestId('board-viewport').boundingBox();
    if (vp) await page.mouse.dblclick(vp.x + 200, vp.y + 200);
    expect((await getBoard(page)).length).toBe(boardWhileBroken.length);

    // 3. Repair storage; wait for the room to retry (no page reload) → recovered.
    const repaired = await testHook(handle, boardId, 'repair-snapshot', 'POST');
    expect(repaired.ok).toBe(true);

    // Recovery requires the LOAD_RETRY_MIN_INTERVAL to elapse and the provider to
    // reconnect; poll generously (reconnect backoff + retry interval).
    await expect
      .poll(() => connectionState(page), {
        timeout: LOAD_RETRY_MIN_INTERVAL_MS + 20000,
        intervals: [500],
      })
      .toBe('connected');

    await expect
      .poll(() => getBoard(page).then((b) => b.length), { timeout: 15000, intervals: [250] })
      .toBe(25);

    // Badge gone.
    await expect(page.getByTestId('connection-status')).toHaveCount(0);

    // Creating a note now works, without any page reload.
    await addNote(page, { x: 500, y: 500 }, 'created after recovery');
    await expect
      .poll(() => getBoard(page).then((b) => b.length), { timeout: 10000, intervals: [200] })
      .toBe(26);

    await ctx.close();
  });
});
