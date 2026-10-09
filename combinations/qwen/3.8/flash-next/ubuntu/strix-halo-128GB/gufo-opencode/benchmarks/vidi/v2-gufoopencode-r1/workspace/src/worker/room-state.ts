import { LOAD_RETRY_MIN_INTERVAL_MS } from '../shared/config';

// The lifecycle of a BoardRoom instance, as a pure transition function so the
// whole diagram from the design can be covered by unit tests (TC-27).
//
//   loading --load-succeeded--> ready
//   loading --load-failed--> load-failed
//   ready --begin-compact--> compacting
//   compacting --compact-succeeded | compact-failed--> ready (rollback)
//   ready --storage-error--> storage-failed
//   storage-failed --reload--> loading
//   ready --idle--> hibernated
//   hibernated --wake--> loading
//   load-failed --retry-load (elapsed >= LOAD_RETRY_MIN_INTERVAL_MS)--> loading
//
// Any event that does not apply in the current phase leaves it unchanged.
export type RoomPhase = 'loading' | 'ready' | 'compacting' | 'hibernated' | 'load-failed' | 'storage-failed';

export type RoomEvent =
  | { type: 'load-succeeded'; quarantined: number }
  | { type: 'load-failed' }
  | { type: 'retry-load'; elapsedMs: number }
  | { type: 'begin-compact' }
  | { type: 'compact-succeeded' }
  | { type: 'compact-failed' }
  | { type: 'storage-error' }
  | { type: 'reload' }
  | { type: 'idle' }
  | { type: 'wake' };

export function nextRoomState(phase: RoomPhase, event: RoomEvent): RoomPhase {
  switch (phase) {
    case 'loading':
      if (event.type === 'load-succeeded') return 'ready';
      if (event.type === 'load-failed') return 'load-failed';
      return phase;
    case 'ready':
      if (event.type === 'begin-compact') return 'compacting';
      if (event.type === 'storage-error') return 'storage-failed';
      if (event.type === 'idle') return 'hibernated';
      return phase;
    case 'compacting':
      // Both outcomes land back in ready: a failed compaction rolls back and
      // the room keeps serving from the old snapshot plus log.
      if (event.type === 'compact-succeeded' || event.type === 'compact-failed') return 'ready';
      return phase;
    case 'hibernated':
      if (event.type === 'wake') return 'loading';
      return phase;
    case 'load-failed':
      // Retrying too early keeps the room in load-failed (the caller closes
      // the connecting socket with CLOSE_BOARD_LOAD_FAILED).
      if (event.type === 'retry-load' && event.elapsedMs >= LOAD_RETRY_MIN_INTERVAL_MS) return 'loading';
      return phase;
    case 'storage-failed':
      if (event.type === 'reload') return 'loading';
      return phase;
  }
}
