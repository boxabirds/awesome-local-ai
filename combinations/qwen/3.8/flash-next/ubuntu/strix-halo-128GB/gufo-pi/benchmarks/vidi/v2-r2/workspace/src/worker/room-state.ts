// Pure room lifecycle state machine (story 4).
//
// This mirrors the lifecycle diagram in the design: a Durable Object wakes to
// `loading`, becomes `ready` (possibly after quarantining damaged log rows), or
// `load-failed`. While ready it can compact (transient `compacting`), hibernate,
// or hit a storage write failure (`storage-failed`). Every transition is a pure
// function of (state, event); unrecognised events leave the state unchanged.

export type LifecycleState =
  | 'loading'
  | 'ready'
  | 'load-failed'
  | 'compacting'
  | 'storage-failed'
  | 'hibernated';

export type LifecycleEvent =
  | { type: 'load-ok' } // snapshot + log applied cleanly
  | { type: 'load-quarantined' } // log rows quarantined, rest applied
  | { type: 'load-failed' } // snapshot unreadable or SQL error
  | { type: 'update' } // an update was applied, stored and broadcast
  | { type: 'compact' } // log crossed the compaction threshold
  | { type: 'compact-ok' } // snapshot replaced, log truncated
  | { type: 'compact-error' } // compaction rolled back, log intact
  | { type: 'storage-error' } // an insert threw
  | { type: 'reload' } // storage-failed: next connection reloads from storage
  | { type: 'hibernate' } // ready with no events: sockets may stay open
  | { type: 'wake' } // hibernated: a message or connection wakes the object
  | { type: 'retry'; elapsed: boolean }; // load-failed: retry after the interval?

/**
 * Return the next lifecycle state for a (state, event) pair. Invalid events for
 * a state return the state unchanged (negative transitions are no-ops).
 */
export function nextRoomState(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  switch (state) {
    case 'loading':
      switch (event.type) {
        case 'load-ok':
        case 'load-quarantined':
          return 'ready';
        case 'load-failed':
          return 'load-failed';
        default:
          return state;
      }
    case 'ready':
      switch (event.type) {
        case 'update':
          return 'ready';
        case 'compact':
          return 'compacting';
        case 'storage-error':
          return 'storage-failed';
        case 'hibernate':
          return 'hibernated';
        default:
          return state;
      }
    case 'compacting':
      switch (event.type) {
        case 'compact-ok':
        case 'compact-error':
          return 'ready';
        default:
          return state;
      }
    case 'load-failed':
      switch (event.type) {
        case 'retry':
          return event.elapsed ? 'loading' : 'load-failed';
        default:
          return state;
      }
    case 'storage-failed':
      switch (event.type) {
        case 'reload':
          return 'loading';
        default:
          return state;
      }
    case 'hibernated':
      switch (event.type) {
        case 'wake':
          return 'loading';
        default:
          return state;
      }
    default:
      return state;
  }
}
