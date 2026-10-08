import { expect, test, type BrowserContext } from '@playwright/test';
import { buildRetroBoard, RETRO_NOTE_COUNT } from '../fixtures/boards';
import { NodeWsClient } from './helpers/node-ws-client';
import { newBoard } from './helpers/participants';
import { WranglerProcess, agentPort, freshPersistDir } from './helpers/wrangler-process';

// Each test runs its OWN wrangler on its OWN port (offset 5/6 of the agent
// range; the shared webServer owns offset 1, the persistence tests own 2/3/4)
// so a lingering workerd from one test can never shadow another.
const PORT_TC24 = agentPort(5);
const PORT_NO_HOOKS = agentPort(6);

const LOAD_FAILED_BADGE = "This board couldn't be loaded. Retrying…";

/**
 * Broken-board e2e (story 4, TC-24 + production-hook check): a damaged
 * compacted snapshot must fail HONESTLY in a real browser — the red
 * "couldn't be loaded. Retrying…" badge, editing locked out — and, once the
 * snapshot is repaired, the board must come back on the SAME page (no reload)
 * when the room's next retry reloads it.
 *
 * The wrangler for TC-24 is started with TEST_HOOKS=1 so the test-only
 * storage damage/repair routes exist (they are never registered in the
 * production config). The second test starts a wrangler WITHOUT TEST_HOOKS
 * and verifies those paths serve the SPA, not the hooks.
 */

test.describe('broken board (persist.client_status) e2e', () => {
  test('TC-24: damaged snapshot → honest failure, edit lock, recovery without reload', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(180_000);
    const boardId = newBoard();
    const persistTo = freshPersistDir();
    const wrangler = new WranglerProcess(PORT_TC24, persistTo, { TEST_HOOKS: '1' });
    await wrangler.start();
    let ctx: BrowserContext | null = null;
    try {
      // Seed the 25-note retro board from Node over the real sync protocol,
      // so the persisted bytes are real Yjs updates (53 log rows, LogOnly).
      const seeder = await NodeWsClient.connect(wrangler.port, boardId);
      await seeder.waitForSync();
      buildRetroBoard(seeder.doc);
      // A probe confirms the room applied + stored all 25 before we move on.
      const probe = await NodeWsClient.connect(wrangler.port, boardId);
      await probe.waitForSync();
      await probe.waitForNotes(RETRO_NOTE_COUNT);
      probe.close();
      seeder.close();

      // Damage the compacted snapshot. The hook forces a snapshot (a 25-note
      // board never crosses the natural compaction threshold), overwrites
      // chunk 0, then re-runs the REAL load path so the room fails and enters
      // load-failed (new sockets are closed 4500). Awaited: by the time this
      // resolves the room is definitively load-failed.
      const corrupt = await fetch(
        `${wrangler.url}/__test/boards/${encodeURIComponent(boardId)}/corrupt-snapshot`,
        { method: 'POST' },
      );
      expect(corrupt.status).toBe(200);
      await corrupt.body?.cancel();

      // Open the board in a fresh context: an honest red failure, not a blank
      // board and not a silent empty one.
      ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${wrangler.url}/b/${encodeURIComponent(boardId)}`);
      await page.waitForSelector('[data-testid="board-viewport"]');
      await page.waitForFunction(
        () => window.__vidi6?.connectionState === 'load_failed',
        undefined,
        { timeout: 20_000, polling: 100 },
      );
      const badge = page.getByTestId('connection-status');
      await badge.waitFor({ timeout: 5_000 });
      expect((await badge.textContent())?.trim()).toBe(LOAD_FAILED_BADGE);
      // The failed board shows no notes (the room refused to serve an empty doc).
      expect(await page.locator('[data-sticky-note]').count()).toBe(0);

      // Editing is locked out: a double-click and the Sticky note button
      // create nothing while load_failed.
      await page.mouse.dblclick(640, 300);
      await page.waitForTimeout(400);
      expect(await page.locator('[data-sticky-note]').count()).toBe(0);
      expect(await page.getByTestId('sticky-note-button').isDisabled()).toBe(true);

      // Repair the snapshot. The client keeps retrying on its own backoff; the
      // room re-attempts a load once LOAD_RETRY_MIN_INTERVAL_MS has elapsed
      // and then syncs the (repaired) board to the SAME page — no reload.
      const repair = await fetch(
        `${wrangler.url}/__test/boards/${encodeURIComponent(boardId)}/repair`,
        { method: 'POST' },
      );
      expect(repair.status).toBe(200);
      await repair.body?.cancel();

      await page.waitForFunction(
        (count) =>
          (window.__vidi6?.connectionState === 'connected' ||
            window.__vidi6?.connectionState === 'confirmed') &&
          document.querySelectorAll('[data-sticky-note]').length >= count,
        RETRO_NOTE_COUNT,
        { timeout: 60_000, polling: 200 },
      );
      // The red failure badge is gone (hidden or the transient green "Connected").
      const afterBadge = await page.evaluate(
        () => document.querySelector('[data-testid="connection-status"]')?.textContent ?? null,
      );
      expect(afterBadge).not.toBe(LOAD_FAILED_BADGE);

      // Editing works again on the same page: the Sticky button is enabled and
      // creates a 26th note.
      expect(await page.getByTestId('sticky-note-button').isDisabled()).toBe(false);
      await page.getByTestId('sticky-note-button').click({ timeout: 10_000 });
      await page.waitForFunction(
        (count) => document.querySelectorAll('[data-sticky-note]').length === count,
        RETRO_NOTE_COUNT + 1,
        { timeout: 10_000, polling: 100 },
      );
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
      await wrangler.stop();
    }
  });

  test('without TEST_HOOKS the hook paths serve the SPA, not the hooks', async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    const boardId = newBoard();
    const persistTo = freshPersistDir();
    // No TEST_HOOKS: the production-equivalent worker has no hook routes.
    const wrangler = new WranglerProcess(PORT_NO_HOOKS, persistTo);
    await wrangler.start();
    try {
      for (const action of ['corrupt-snapshot', 'repair']) {
        const res = await fetch(
          `${wrangler.url}/__test/boards/${encodeURIComponent(boardId)}/${action}`,
          { method: 'POST' },
        );
        const body = await res.text();
        // Without TEST_HOOKS the hooks are not registered: the request falls
        // through to the static-asset server (405 Method Not Allowed for a
        // POST), never the hook's JSON payload. A GET to the same path serves
        // the SPA (index.html) instead.
        expect(res.status).not.toBe(200);
        expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
        expect(body).not.toContain('"action"');

        const getRes = await fetch(
          `${wrangler.url}/__test/boards/${encodeURIComponent(boardId)}/${action}`,
        );
        expect(getRes.headers.get('content-type') ?? '').toContain('text/html');
        await getRes.body?.cancel();
      }
    } finally {
      await wrangler.stop();
    }
  });
});
