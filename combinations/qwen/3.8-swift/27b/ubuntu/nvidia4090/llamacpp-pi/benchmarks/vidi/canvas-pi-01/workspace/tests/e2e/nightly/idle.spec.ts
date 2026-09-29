// Nightly e2e (spec: sync.client, task 9): long-running verification of the
// sync.client contract that is too slow for every commit.
//
// TC-29: an idle connection stays `connected` (the badge never shows
// "Reconnecting…" and the mapped state never leaves `connected`) for 45 s.
// This proves the awareness relay + provider options defeat y-websocket's
// 30 s no-message watchdog.

import { expect, test } from '@playwright/test';
import {
  closeParticipant,
  createFreshBoard,
  openParticipant,
} from '../helpers/participants';

/** How long the idle connection must hold (spec: 45 s). */
const IDLE_DURATION_MS = 45_000;
const IDLE_TICK_MS = 1000;

test('TC-29: an idle connection never leaves the connected state for 45 s', async ({  browser,
  request,
}) => {
  test.setTimeout(IDLE_DURATION_MS + 60_000);
  const boardId = await createFreshBoard(request);
  const a = await openParticipant(browser, boardId);
  const b = await openParticipant(browser, boardId);
  try {
    // Poll the mapped connection state continuously for the whole idle period.
    const deadline = Date.now() + IDLE_DURATION_MS;
    let sawReconnecting = false;
    let leftConnected = false;
    while (Date.now() < deadline) {
      const [sa, sb] = await Promise.all([
        a.page.evaluate(() => window.__vidi6?.connectionState ?? 'unknown'),
        b.page.evaluate(() => window.__vidi6?.connectionState ?? 'unknown'),
      ]);
      const badgeVisible = await a.page
        .locator('[data-testid="connection-status"]')
        .count();
      if (sa === 'reconnecting' || sb === 'reconnecting') sawReconnecting = true;
      if (sa !== 'connected' && sa !== 'unknown') leftConnected = true;
      if (sb !== 'connected' && sb !== 'unknown') leftConnected = true;
      // The badge must never render "Reconnecting…" while idle.
      if (badgeVisible > 0) {
        const text = await a.page.locator('[data-testid="connection-status"]').textContent();
        if (text === 'Reconnecting…') sawReconnecting = true;
      }
      await new Promise((r) => setTimeout(r, IDLE_TICK_MS));
    }
    expect(sawReconnecting).toBe(false);
    expect(leftConnected).toBe(false);
  } finally {
    await closeParticipant(a);
    await closeParticipant(b);
  }
});
