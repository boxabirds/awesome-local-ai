import { expect, test } from '@playwright/test';
import { freshBoardId, join } from '../helpers/participants';

/**
 * sync.client idle stability (task 9, TC-29).
 *
 * Two contexts sit on the same board with no user activity for 45 s. The
 * client's mapped state must never leave `connected` and the badge must
 * never render. This is the guarantee that the y-websocket provider's
 * 30-second no-message watchdog never fires on an idle connection: each
 * client's Awareness renews its local state every 15 s (y-protocols
 * auto-renewal), the room relays every awareness frame back to *all*
 * sockets including the sender, so every peer keeps receiving messages
 * well inside the watchdog window.
 */
test('TC-29 two idle editors stay connected for 45 s: state never leaves connected, badge never renders', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const boardId = freshBoardId();
  const a = await join(browser, boardId);
  const b = await join(browser, boardId);
  const start = Date.now();
  let samples = 0;
  try {
    // Sample both contexts every 2 s; the invariants hold at every sample.
    while (Date.now() - start < 45_000) {
      const [sa, sb] = await Promise.all([
        a.page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6
              ?.connectionState ?? null,
        ),
        b.page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6
              ?.connectionState ?? null,
        ),
      ]);
      expect(sa, `a left connected after ${Date.now() - start}ms idle`).toBe('connected');
      expect(sb, `b left connected after ${Date.now() - start}ms idle`).toBe('connected');
      // The connection badge must never render while idle. (The page has other
      // role=status nodes — the zoom output and the hint — so target the badge.)
      await expect(a.page.locator('.vidi6-badge')).toHaveCount(0);
      await expect(b.page.locator('.vidi6-badge')).toHaveCount(0);
      samples += 1;
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(
      `TC-29 idle soak OK: ${samples} clean samples over ${Date.now() - start}ms (2 contexts)`,
    );
  } finally {
    await a.close();
    await b.close();
  }
});
