/**
 * The client's link to a board room (`sync.client`).
 *
 * `connectBoard` attaches a `y-websocket` provider to the board's `Y.Doc`: the
 * document is the thing that is synchronised, so nothing else in the app has to
 * know that a network exists — local edits go into the doc, remote edits arrive
 * in it, and `useBoardDoc` re-renders from the same observer it always had.
 *
 * The provider is configured so that what the tests describe is what happens:
 * `disableBc` turns off y-websocket's BroadcastChannel, otherwise two tabs of
 * the same browser would sync through the channel and never prove that the
 * server relays anything; `maxBackoffTime` bounds the reconnect delay.
 */

import { WebsocketProvider } from "y-websocket";
import type * as Y from "yjs";
import { RECONNECT_MAX_BACKOFF_MS } from "../../shared/config";
import { createConnectionStateMachine, type ConnectionState } from "./connection-state";

export type { ConnectionState } from "./connection-state";

export interface BoardConnection {
  /** Closes the socket and stops the provider. Safe to call more than once. */
  destroy(): void;
}

/** `/api/rooms` on the same origin that served this page. */
export function roomBaseUrl(): string {
  const secure = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
  return `${secure}//${globalThis.location.host}/api/rooms`;
}

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const machine = createConnectionStateMachine(onState);

  const provider = new WebsocketProvider(roomBaseUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  provider.on("status", ({ status }) => machine.handle(status));
  provider.on("sync", (synced) => machine.handle(synced ? "synced" : "unsynced"));

  // An awareness state is what keeps an idle board's connection alive:
  // `y-protocols` renews the local state periodically, the provider sends it,
  // and the room relays it back to everyone including the sender. Without a
  // local state an idle client hears nothing at all, and y-websocket's "no
  // message for 30 seconds" watchdog drops a perfectly healthy connection.
  // What the state *contains* (names, cursors) is story 6.
  provider.awareness.setLocalStateField("board", boardId);

  let destroyed = false;
  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      machine.destroy();
      provider.destroy();
    },
  };
}
