/**
 * E2E broken board (TC-24): persist.client_status in a real browser.
 *
 * A 25-note board's snapshot is corrupted via the test-only hook; a fresh
 * context sees the honest red "couldn't be loaded" state with editing locked
 * (create does nothing); after the repair hook the SAME context recovers to
 * the full board (25 notes, badge gone, editing re-enabled) with NO page
 * reload — the provider kept retrying and the room reloaded on a new
 * connection. A second test verifies a normal build (no TEST_HOOKS) exposes
 * no /__test/ routes (they fall through to the SPA).
 */
import { test, expect } from '@playwright/test';
import { startWranglerProcess, type WranglerProcess } from '../helpers/wrangler-process';
import { seedBoard } from '../helpers/seed-board';
import { createBoard } from '../helpers/api';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
} from '../../../src/shared/config';

const PORT = 20616;
const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

/** Call a test-only storage hook and assert it succeeded. */
async function postHook(port: number, boardId: string, action: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/${action}`, {
    method: 'POST',
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok !== true) {
    throw new Error(`hook ${action} failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

test.describe('broken board (persist.client_status)', () => {
  test('TC-24: corrupt → honest failure + edit lock → repair → recovery without reload', async ({
    browser,
  }) => {
    let wrangler: WranglerProcess | null = null;
    try {
      wrangler = await startWranglerProcess(PORT, undefined, {
        config: 'wrangler.test-hooks.jsonc',
      });
      // 1. Create a 25-note board (story 5: seedBoard creates it via
      // POST /api/boards) and corrupt its snapshot.
      const boardId = await seedBoard(PORT, 25);
      await postHook(PORT, boardId, 'corrupt-snapshot');

      // 2. Open the board in a fresh context → red badge, editing locked.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`/b/${boardId}`);
      const badge = page.getByTestId('connection-status');
      // Wait for the load-failed state (the room rejects the connection with 4500
      // once its reload fails; the provider maps that to `load_failed`).
      await expect
        .poll(async () => (await badge.textContent()) ?? '', {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toContain(LOAD_FAILED_TEXT);
      // The board is unreadable: no notes are rendered.
      await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
      // Dblclick on empty space creates nothing (editing locked).
      await page.mouse.dblclick(400, 300);
      await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
      // The Sticky note button is disabled.
      await expect(page.getByTestId('create-sticky-btn')).toBeDisabled();

      // 3. Repair; the SAME context recovers (no reload) once the room reloads
      //    (>= LOAD_RETRY_MIN_INTERVAL_MS) and the provider re-syncs.
      await postHook(PORT, boardId, 'repair');
      await expect
        .poll(async () => page.locator('[data-testid="sticky-note"]').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS + LOAD_RETRY_MIN_INTERVAL_MS,
        })
        .toBe(25);
      // Badge gone (connected) and editing works again.
      await expect(badge).toHaveCount(0);
      await page.mouse.dblclick(500, 400);
      await expect
        .poll(async () => page.locator('[data-testid="sticky-note"]').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(26);
      await context.close();
    } finally {
      await wrangler?.stop();
    }
  });

  test('TC-24: a normal build (no TEST_HOOKS) exposes no /__test/ hook routes', async () => {
    let wrangler: WranglerProcess | null = null;
    try {
      wrangler = await startWranglerProcess(PORT); // no TEST_HOOKS var
      const boardId = await createBoard(`http://127.0.0.1:${PORT}`);
      const res = await fetch(
        `http://127.0.0.1:${PORT}/__test/boards/${boardId}/corrupt-snapshot`,
        { method: 'POST' },
      );
      // The hook is absent: the request is NOT handled by the worker's /__test/
      // route (which would return 200 application/json `{"ok":true}`). It falls
      // through to the assets, which reject the POST (405) — never the hook JSON.
      const text = await res.text();
      expect(text).not.toContain('"ok":true');
      expect(res.status).not.toBe(200);
      expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    } finally {
      await wrangler?.stop();
    }
  });
});
