/**
 * The connection state behind the badge (`sync.client`).
 *
 * A `y-websocket` provider reports three things: a transport status
 * (`connecting`, `connected`, `disconnected`) and whether the document has
 * synced with the room. Those are plumbing; what the person on the board needs
 * is one of four states:
 *
 * - `connecting`   — the first load, before this client has ever synced.
 * - `connected`    — in sync with the room (the badge hides itself).
 * - `reconnecting` — the connection was lost and the board is running on the
 *                    local document until it comes back.
 * - `confirmed`    — a lost connection has just come back: "Connected" is shown
 *                    for CONNECTED_CONFIRMATION_MS so it is actually seen, then
 *                    the state settles to `connected`.
 *
 * The machine takes the provider's own signals as input, which is what lets the
 * component tests drive it with a fake emitter and fake timers.
 */

import { CONNECTED_CONFIRMATION_MS } from "../../shared/config";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "confirmed";

/** The signals a `y-websocket` provider reports. */
export type ProviderSignal = "connecting" | "connected" | "disconnected" | "synced" | "unsynced";

export interface ConnectionStateMachine {
  readonly state: ConnectionState;
  /** Feeds one provider signal in. */
  handle(signal: ProviderSignal): void;
  /** Stops the confirmation timer. Called when the connection is torn down. */
  destroy(): void;
}

export function createConnectionStateMachine(
  onState: (state: ConnectionState) => void,
  confirmationMs: number = CONNECTED_CONFIRMATION_MS,
): ConnectionStateMachine {
  let state: ConnectionState = "connecting";
  /** Once this client has synced, a lost connection is a *re*connection. */
  let syncedOnce = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const move = (next: ConnectionState): void => {
    if (confirmation !== null) {
      clearTimeout(confirmation);
      confirmation = null;
    }
    if (state === next) return;
    state = next;
    if (!destroyed) onState(next);
  };

  const confirmThenConnect = (): void => {
    move("confirmed");
    confirmation = setTimeout(() => {
      confirmation = null;
      move("connected");
    }, confirmationMs);
  };

  return {
    get state(): ConnectionState {
      return state;
    },

    handle(signal: ProviderSignal): void {
      switch (signal) {
        case "synced":
          syncedOnce = true;
          // A reconnect that only now synced: the board has been offline until
          // this moment, so its return is worth showing.
          if (state === "reconnecting") confirmThenConnect();
          else move("connected");
          return;

        case "unsynced":
        case "disconnected":
          move(syncedOnce ? "reconnecting" : "connecting");
          return;

        case "connected":
          // The socket is open but the document has not exchanged state with
          // the room yet, so this is not yet a usable connection.
          move(syncedOnce ? "reconnecting" : "connecting");
          return;

        case "connecting":
          if (state !== "reconnecting" && state !== "confirmed") move("connecting");
          return;
      }
    },

    destroy(): void {
      destroyed = true;
      if (confirmation !== null) {
        clearTimeout(confirmation);
        confirmation = null;
      }
    },
  };
}
