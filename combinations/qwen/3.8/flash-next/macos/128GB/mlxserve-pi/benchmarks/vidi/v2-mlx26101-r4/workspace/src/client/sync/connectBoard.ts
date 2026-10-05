/**
 * The browser's half of the live board: the connection to a board room, and the
 * small state machine that says what that connection means to the person editing.
 *
 * The transport is the `y-websocket` provider, which does the syncing: it sends
 * what this tab has and asks for what it is missing every time the socket opens.
 * That is why nothing is lost when a connection drops while the page stays open —
 * the edits go on going into the local document, and the next socket carries them
 * out. What this file adds is only the part the product has to get right: turning
 * "socket open", "socket closed" and "documents agree" into
 * `connecting | connected | reconnecting | confirmed`, so the badge can tell the
 * truth about whether anyone else can see this person's work.
 */
import { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/**
 * What the board's connection looks like to the person using it.
 *
 * `load_failed` is the one state that is not about the socket: it means the board
 * behind the socket could not be read. It is separated from `reconnecting` because
 * the two ask for different things from the person in front of them — one is a
 * reason to keep typing, the other is a reason to stop, because there is no board
 * here to type into and an empty one is not going to be handed over as if it were.
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** What the provider says about its socket. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

/** Everything the state machine needs to be told; a provider satisfies it exactly. */
export interface ConnectionTracker {
  /** The socket's state changed. */
  status(status: ProviderStatus): void;
  /** The two documents came into agreement (or fell out of it). */
  synced(synced: boolean): void;
  /**
   * The socket closed with this code, or with `null` when we closed it ourselves.
   *
   * The code is the only thing that tells a refused board apart from a dropped
   * connection, and the two say opposite things to the person editing.
   */
  close(code: number | null): void;
  /** Stop reporting; the connection is being torn down. */
  destroy(): void;
}

/** A board connection, plus the means to end it. */
export interface BoardConnection {
  destroy(): void;
  /**
   * Cut the socket as thoroughly as a dead network would, leaving the retry schedule to
   * bring it back. Only test builds have any use for it, and it exists because Playwright
   * cannot do this from outside: `context.setOffline` stops a page from making new
   * connections, while a board that is already connected keeps the connection it has.
   * Everything after this call is the product's own behaviour — the document goes on
   * accepting edits, the badge says what it means, and the next socket carries both
   * directions of what was written meanwhile.
   */
  drop(): void;
}

/**
 * The mapping from provider events to the states the product shows.
 *
 * A socket that is open but not yet synced is not yet something a change can
 * travel over, so "connected" waits for the documents to agree. The first time
 * they do there is nothing to reassure anybody about and the badge stays hidden;
 * every time after a drop it shows "Connected" for CONNECTED_CONFIRMATION_MS, so
 * the person who was cut off can see their work is on its way again.
 *
 * Exposed on its own because it is the part with rules in it, and so the part the
 * component tests drive directly, with fake timers, instead of an outage.
 */
export function createConnectionTracker(onState: (state: ConnectionState) => void): ConnectionTracker {
  let state: ConnectionState = 'connecting';
  // Set once the documents have agreed at least once, and never unset after that: from
  // then on this is a board that had a connection and lost one, which is worth saying
  // "Reconnecting…" about, not a board that is still loading. The distinction matters on
  // a retry, where the provider reports "connecting" again between two attempts.
  let everSynced = false;
  // Set by a refusal and cleared by the first sync: while it is set, every state
  // that a retry would otherwise report — dialling, dropped again, still trying —
  // is reported as the refusal instead, because that is the only thing the person
  // needs to know and it must not flicker away between attempts.
  let refusing = false;
  let confirmation: ReturnType<typeof setTimeout> | null = null;

  const show = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  /** The green confirmation is on a clock; nobody waits out a timer they can undo. */
  const hideConfirmation = (): void => {
    if (confirmation === null) return;
    clearTimeout(confirmation);
    confirmation = null;
  };

  return {
    status(status) {
      if (status === 'disconnected') {
        // The provider is already trying again in the background, with a wait that
        // doubles up to RECONNECT_MAX_BACKOFF_MS. The board is not locked while
        // that happens: this says "nobody else can see you right now", not "stop".
        hideConfirmation();
        show(refusing ? 'load_failed' : 'reconnecting');
        return;
      }
      if (status === 'connecting' && !everSynced) show(refusing ? 'load_failed' : 'connecting');
      // `connected` on its own is a socket that has not carried anything yet.
    },

    synced(synced) {
      if (!synced) {
        hideConfirmation();
        // A board that has never agreed is still loading, not broken: only a board that
        // was saying it was live has anything to report.
        if (state === 'connected' || state === 'confirmed') show('reconnecting');
        return;
      }
      if (refusing) {
        // The board loaded. This is the recovery the message promised: editing is
        // on again and the badge goes quiet, without a reload. It says "Connected"
        // rather than reassuring anybody about a drop they were never told about.
        refusing = false;
        everSynced = true;
        hideConfirmation();
        show('connected');
        return;
      }
      const returned = everSynced;
      everSynced = true;
      hideConfirmation();
      if (returned) {
        show('confirmed');
        confirmation = setTimeout(() => {
          confirmation = null;
          // Only the confirmation itself gives way: if the board dropped again in
          // the meantime, that is what the badge should be showing.
          if (state === 'confirmed') show('connected');
        }, CONNECTED_CONFIRMATION_MS);
        return;
      }
      show('connected');
    },

    close(code) {
      hideConfirmation();
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        refusing = true;
        show('load_failed');
        return;
      }
      // Everything else — 1011 (the room could not write the board down), 1003 (a
      // message it could not read), a dropped network, our own `drop()` — is a
      // connection that will be tried again with a readable board on the other
      // side, so editing stays on and the changes go with the next socket.
      if (!refusing) show('reconnecting');
    },

    destroy() {
      hideConfirmation();
      everSynced = false;
      refusing = false;
    },
  };
}

/** The provider URL space: `wss://host/api/rooms` for the room named `boardId`. */
function roomUrl(): string {
  if (typeof location === 'undefined') return 'ws://127.0.0.1/api/rooms';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms`;
}

/**
 * Connect a board document to its room.
 *
 * Cross-tab broadcasting is switched off: two tabs of the same browser must reach
 * each other through the room and nowhere else, or a broken server would go
 * unnoticed while the board appeared to work. Reconnects wait at most
 * RECONNECT_MAX_BACKOFF_MS between tries.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
): BoardConnection {
  const provider = new WebsocketProvider(roomUrl(), boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  const tracker = createConnectionTracker(onState);
  const onStatus = (event: { status: ProviderStatus }): void => tracker.status(event.status);
  const onSync = (synced: boolean): void => tracker.synced(synced);
  // `null` when the provider closed the socket itself (a `drop()`, or its own
  // watchdog): a close we asked for carries no verdict about the board.
  const onClose = (event: { code: number } | null): void => tracker.close(event === null ? null : event.code);
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('connection-close', onClose);
  // The badge is already saying "Connecting…" before the first byte is sent, so it
  // is told that now rather than waiting for the provider to notice it too.
  onState('connecting');

  return {
    destroy() {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('connection-close', onClose);
      tracker.destroy();
      provider.destroy();
    },
    drop() {
      // Closing the socket this way is a close from the other end: the provider notices
      // it, says so, and dials again on its own schedule. The provider is left alone.
      provider.ws?.close();
    },
  };
}
