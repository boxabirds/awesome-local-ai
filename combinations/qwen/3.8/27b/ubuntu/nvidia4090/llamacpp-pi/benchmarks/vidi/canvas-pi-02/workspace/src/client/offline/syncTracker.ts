/**
 * Sync acknowledgement tracker (story 13, offline.sync_ack).
 *
 * Pure functions for unit testing: classifyFrame and createSyncTracker.
 */
import { MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC_ACK } from '../../shared/protocol';

export type TrackerState = 'synced' | 'pending_offline' | 'syncing';

/**
 * Classify a WebSocket frame as 'data' (SyncStep2 or Update) or 'other'.
 * Data frames are the ones the room acks.
 */
export function classifyFrame(data: ArrayBufferLike | string): 'data' | 'other' {
  if (typeof data === 'string') return 'other';

  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : data instanceof SharedArrayBuffer
      ? new Uint8Array(data as unknown as ArrayBuffer)
      : new Uint8Array((data as ArrayBufferLike).slice ? (data as ArrayBuffer).slice(0) : data as ArrayBuffer);

  if (bytes.length === 0) return 'other';

  // Read the first varuint (message type).
  // For our values (< 128), it's a single byte.
  const msgType = bytes[0];

  if (msgType !== MESSAGE_SYNC) return 'other';
  if (bytes.length < 2) return 'other';

  // Read the inner sync message type (second varuint).
  // SYNC_STEP_1 = 0, SYNC_STEP_2 = 1, UPDATE = 2 (y-protocols).
  const syncType = bytes[1];

  // SyncStep2 (1) and Update (2) are data frames.
  if (syncType === 1 || syncType === 2) return 'data';

  return 'other';
}

export interface SyncTrackerOptions {
  boardId: string;
  initiallyUnsynced: boolean;
  persistFlag(unsynced: boolean): Promise<void>;
}

export interface SyncTracker {
  onLocalChange(): void;
  onConnected(): void;
  onDisconnected(): void;
  onSend(frame: ArrayBufferLike | string): void;
  onAck(count: number): void;
  state(): TrackerState;
  subscribe(fn: (s: TrackerState) => void): () => void;
  hasUnsynced(): boolean;
}

export function createSyncTracker(opts: SyncTrackerOptions): SyncTracker {
  let sent = 0;
  let acked = 0;
  let connected = false;
  let state: TrackerState = opts.initiallyUnsynced ? 'pending_offline' : 'synced';
  const listeners = new Set<(s: TrackerState) => void>();

  function setState(s: TrackerState) {
    if (state !== s) {
      state = s;
      listeners.forEach((fn) => fn(s));
    }
  }

  function updateState() {
    if (!connected) {
      // Disconnected: if we have unsent changes or were pending, stay pending_offline.
      if (sent > acked || state === 'pending_offline') {
        setState('pending_offline');
      } else {
        setState('synced');
      }
      return;
    }

    // Connected: if we were pending_offline (had unsynced changes from before),
    // stay pending_offline until the first send+ack cycle completes.
    if (state === 'pending_offline' && sent === 0 && acked === 0) {
      // Still waiting for the handshake to carry our changes.
      return;
    }

    if (sent > acked) {
      setState('syncing');
    } else {
      setState('synced');
    }
  }

  function persist(unsynced: boolean) {
    void opts.persistFlag(unsynced);
  }

  const tracker: SyncTracker = {
    onLocalChange() {
      if (connected) {
        // First local change while connected → syncing.
        if (state === 'synced') {
          persist(true);
        }
        setState('syncing');
      } else {
        // Local change while disconnected → pending_offline.
        setState('pending_offline');
        persist(true);
      }
    },

    onConnected() {
      connected = true;
      // Reset counters for the new connection.
      sent = 0;
      acked = 0;
      if (state === 'pending_offline') {
        // We have unsynced changes; once the handshake completes they'll be sent and acked.
        // Stay pending_offline until the first send+ack cycle.
        // Actually, the state should transition to syncing once we start sending.
        // For now, stay pending_offline until onSend is called.
      }
      updateState();
    },

    onDisconnected() {
      connected = false;
      if (sent > acked || state === 'syncing') {
        setState('pending_offline');
        persist(true);
      } else if (state === 'pending_offline') {
        // Already pending, keep it.
      } else {
        setState('synced');
      }
      // Counters reset on next connection.
      sent = 0;
      acked = 0;
    },

    onSend(frame: ArrayBufferLike | string) {
      if (classifyFrame(frame) !== 'data') return;
      sent++;
      if (connected && sent > acked) {
        if (state === 'synced') {
          persist(true);
        }
        setState('syncing');
      }
    },

    onAck(count: number) {
      // Clamp: ack should not exceed sent.
      const effectiveAck = Math.min(count, sent);
      if (effectiveAck > acked) {
        acked = effectiveAck;
      }
      if (connected && sent > 0 && acked >= sent) {
        setState('synced');
        persist(false);
      }
    },

    state() {
      return state;
    },

    subscribe(fn: (s: TrackerState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    hasUnsynced() {
      return state === 'pending_offline' || (state === 'syncing' && sent > acked);
    },
  };

  return tracker;
}
