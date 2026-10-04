/**
 * Small waits shared by the live room tests. Everything here is a *functional*
 * wait — "until the thing the test is about happened" — never a fixed pause, so a
 * slow machine slows the test down instead of failing it.
 */

import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { RoomClient } from './ws-client';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the next socket close on this client and report its code.
 *
 * The baseline is the number of closes already recorded when this is called, so a
 * test can wait for a *second* close (a client that was kicked out, reconnected,
 * and is being kicked out again) as easily as for a first one.
 */
export function closeBaseline(client: RoomClient): number {
  return client.closes.length;
}

/**
 * Wait for the close after `from` and report its code. `from` defaults to the
 * closes recorded so far, which is only correct when nothing can have closed
 * before this call — so a test that acts first passes a baseline it took first.
 */
export async function closeWait(
  client: RoomClient,
  from = client.closes.length,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (client.closes.length > from) return client.closes.at(-1)!.code;
    if (Date.now() > deadline) {
      throw new Error(`no socket close after #${from}; this client has ${client.closes.length}`);
    }
    await sleep(10);
  }
}

/**
 * The async twin of `until` in `ws-client.ts`: wait for something that can only
 * be observed over HTTP (a board's storage, a room's status).
 */
export async function untilAsync(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

/** How many times any socket of this client has closed so far. */
export function closeCount(client: RoomClient): number {
  return client.closes.length;
}
