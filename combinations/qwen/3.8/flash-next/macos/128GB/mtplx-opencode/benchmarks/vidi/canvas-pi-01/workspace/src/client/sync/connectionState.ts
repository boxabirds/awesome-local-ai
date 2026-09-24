/**
 * Story 3 · connection state machine (design "Client connection and status").
 *
 * Maps the y-websocket provider's `status` and `sync` signals onto the four
 * UI connection states, and owns the "ConfirmedConnected" confirmation window.
 *
 * It is written as a pure class with injectable timers so the component tests
 * (TC-19..TC-21) can drive a fake provider and advance fake timers without a
 * real socket, while `connectBoard` wires the same machine to a real
 * `WebsocketProvider`.
 *
 * The mapping (design state diagram):
 *   - starts `connecting`;
 *   - connected **and** synced the first time → `connected`;
 *   - a socket close after we had synced → `reconnecting`;
 *   - coming back online while `reconnecting` → `confirmed` for
 *     `CONNECTED_CONFIRMATION_MS`, then `connected`;
 *   - a close during that confirmation window → straight back to
 *     `reconnecting` (TC-21).
 *
 * Story 4 adds the fifth state: a close with `CLOSE_BOARD_LOAD_FAILED` (4500)
 * means the room could not read the board at all, which is different from "not
 * connected right now": the board must not be edited while its real content may
 * be sitting in storage (`load_failed`). Only a successful sync leaves it.
 * `CLOSE_STORAGE_FAILURE` (1011) stays a `reconnecting`: the board is readable
 * and the unsaved change is re-sent when the provider retries.
 */
import { CLOSE_BOARD_LOAD_FAILED } from '../../shared/protocol';

/** The five states the badge can be in. `connected` renders nothing. */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** The y-websocket provider `status` values. */
export type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

type Timer = ReturnType<typeof setTimeout>;

export interface ConnectionMachineOptions {
  onState: (state: ConnectionState) => void;
  setTimeout: (fn: () => void, ms: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  confirmationMs: number;
  /** Used by the component tests to start mid-flow (e.g. already connected). */
  initial?: ConnectionState;
}

export interface ConnectionMachine {
  readonly state: ConnectionState;
  status(status: ProviderStatus): void;
  sync(isSynced: boolean): void;
  /** A socket closed: the close code decides whether the board is editable. */
  close(code: number): void;
}

/**
 * Translate `status` + `sync` into a `ConnectionState`. Keeping `connected`
 * (the socket is open) and `synced` (the doc is up to date) separate matters:
 * an open but not-yet-synced socket is still "Connecting…", and a badge must
 * not flicker to green before the first sync lands.
 */
export function createConnectionMachine(
  options: ConnectionMachineOptions,
): ConnectionMachine {
  const { onState, setTimeout, clearTimeout, confirmationMs } = options;

  let state: ConnectionState = options.initial ?? 'connecting';
  let socketOpen = false;
  let synced = false;
  // True once we have synced at least once, so a later drop means
  // "reconnecting" rather than "still trying to connect the first time".
  let everSynced = state === 'connected' || state === 'confirmed';
  let timer: Timer | null = null;

  const emit = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    onState(next);
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const startConfirmation = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // Only drop out of the confirmation window if we are still in it.
      if (state === 'confirmed') emit('connected');
    }, confirmationMs);
  };

  // Shared "online" handler: called whenever the socket is open and synced.
  const onOnline = (): void => {
    if (state === 'load_failed') {
      // The retry reached a room that could read its board: editing is back on
      // immediately, without the confirmation detour (design: "the first
      // successful sync switches back to connected").
      everSynced = true;
      emit('connected');
      return;
    }
    if (state === 'reconnecting') {
      emit('confirmed');
      startConfirmation();
      return;
    }
    everSynced = true;
    emit('connected');
  };

  return {
    get state() {
      return state;
    },
    status(status: ProviderStatus): void {
      if (status === 'disconnected') {
        socketOpen = false;
        synced = false;
        clearTimer();
        // `load_failed` is only lifted by a successful sync, never by the
        // disconnect that follows the close which caused it.
        if (state === 'load_failed') return;
        // A drop after we had been live is a reconnection; a failure before we
        // ever synced is just the initial connection still being retried.
        emit(everSynced ? 'reconnecting' : 'connecting');
        return;
      }
      socketOpen = status === 'connected';
      if (!socketOpen) {
        // Provider went back to 'connecting' (a retry): hold the current state.
        return;
      }
      if (synced) onOnline();
    },
    sync(isSynced: boolean): void {
      synced = isSynced;
      if (isSynced && socketOpen) onOnline();
    },
    close(code: number): void {
      if (code === CLOSE_BOARD_LOAD_FAILED) {
        emit('load_failed');
        return;
      }
      // Everything else — 1011 (storage failure) included — keeps the board
      // editable: it is readable, and unsaved changes are re-sent on the next
      // sync. A close while we are already told `load_failed` (the retry hit
      // the same broken board) changes nothing: no flicker, no downgrade.
      if (state === 'load_failed') return;
      clearTimer();
      emit(everSynced ? 'reconnecting' : 'connecting');
    },
  };
}