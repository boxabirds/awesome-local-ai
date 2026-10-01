// An outage a browser will actually perform.
//
// `context.setOffline(true)` is the obvious way to ask a browser to lose its
// network, and it does not take an established WebSocket down: probed here in
// Chromium and WebKit under Playwright, `navigator.onLine` goes false while the
// socket sits at readyState 1 for as long as we watched (12 seconds), still able
// to send. A test that asked for an outage that way would be watching a board
// that never lost anything.
//
// So the end-to-end outage test drops the link where an outage drops it — the
// socket — and points this connection's reconnection attempts at an address that
// leads nowhere for as long as the test says. What is left is the thing under
// test and all of it real: the provider notices its socket closed, retries
// against an address that leads nowhere, with its own backoff; the badge says
// Reconnecting…; whatever either person does meanwhile stays on their own screen;
// and when the address works again the two documents sync with the room and
// merge, which is what the story promises.
import type { WebsocketProvider } from 'y-websocket';

/**
 * An address that cannot answer: a host under the reserved `.invalid`
 * TLD (RFC 2606), which no name server will ever resolve. A board that is out of
 * reach is a board whose address leads nowhere, which is what this is. Exported
 * so a test can tell a socket that fails here from a board that is genuinely
 * misbehaving.
 */
export const UNREACHABLE_SERVER = 'ws://board.unreachable.invalid';

/**
 * Close this connection's socket and keep it closed for `ms` milliseconds: the
 * retries in that time go to an address that refuses them, and when the time is
 * up the address goes back to where the rooms are and the connection makes
 * itself again, syncing as it comes.
 *
 * Returns the function that ends the outage early. Nobody calls it during a
 * normal test — the point is the wait.
 */
export function emulateOutage(
  provider: WebsocketProvider,
  ms: number,
  unreachable: string = UNREACHABLE_SERVER,
): () => void {
  const reachable = provider.serverUrl;

  // Put the connection somewhere else and let it try again from there. The
  // provider keeps retrying on its own while it is told to stay connected, so
  // nothing has to drive the outage from outside.
  const sendItTo = (serverUrl: string): void => {
    provider.disconnect();
    provider.serverUrl = serverUrl;
    provider.connect();
  };

  sendItTo(unreachable);
  const back = setTimeout(() => sendItTo(reachable), ms);

  return () => {
    clearTimeout(back);
    if (provider.serverUrl !== reachable) sendItTo(reachable);
  };
}
