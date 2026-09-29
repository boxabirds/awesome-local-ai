import { test, expect } from '@playwright/test';
import {
  openSharedBoard,
  connectionStatus,
  connectionState,
} from '../helpers/board.ts';
import { newBoardId } from '../../../src/shared/board-id.ts';

// Design TC-29 (nightly): two contexts connected to the same board with no user
// activity for 45 s. The provider options (maxBackoffTime, disableBc) plus the
// room's awareness relay must keep the sockets alive so the ConnectionStatus
// badge NEVER shows "Reconnecting…" and the mapped ConnectionState never leaves
// `connected`. This is too slow for every commit, so it lives in the nightly
// project (tests/e2e/nightly), excluded from the default test:e2e run.
const IDLE_MS = 45_000;
const POLL_MS = 1_000;

test('TC-29 idle sockets stay connected for 45s (awareness relay, no Reconnecting)', async ({
  context,
}) => {
  test.setTimeout(90_000);
  const id = newBoardId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openSharedBoard(a, id);
  await openSharedBoard(b, id);

  // Both start connected (badge hidden).
  await expect(connectionStatus(a)).toBeHidden();
  await expect(connectionStatus(b)).toBeHidden();

  const t0 = Date.now();
  while (Date.now() - t0 < IDLE_MS) {
    for (const p of [a, b]) {
      // The badge must never render a reconnecting/label state. count() is
      // instant (no wait) so a transient flicker between polls is still caught
      // on the next poll, and a persistent Reconnecting is caught immediately.
      const count = await connectionStatus(p).count();
      if (count > 0) {
        const txt = (await connectionStatus(p).textContent()) ?? '';
        expect(txt, `badge should never say Reconnecting: ${txt}`).not.toMatch(/reconnect/i);
      }
      const st = await connectionState(p);
      if (st !== undefined) expect(st).toBe('connected');
    }
    await a.waitForTimeout(POLL_MS);
  }

  // Still connected (hidden badge, mapped state connected) after the idle window.
  await expect(connectionStatus(a)).toBeHidden();
  await expect(connectionStatus(b)).toBeHidden();
  expect(await connectionState(a)).toBe('connected');
});
