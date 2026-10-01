import { describe, expect, it } from 'vitest';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import {
  closeCodeFor,
  nextRoomState,
  type RoomEvent,
  type RoomState,
} from '../../src/worker/room-state';

/**
 * TC-27: every edge of the room's lifecycle diagram, as a pure transition. The
 * room holds one of these states; this says what each event does — including
 * the ones that must do nothing (an event that does not belong to a state
 * leaves it exactly as it was, which is what keeps a stray message from moving
 * the room somewhere it should not be).
 */

const ALL_STATES: RoomState[] = [
  'loading',
  'ready',
  'compacting',
  'storage-failed',
  'hibernated',
  'load-failed',
];

/** Every event, with the neutral `retryDue` variants the ones that need it. */
const ALL_EVENTS: RoomEvent[] = [
  { type: 'load-ok' },
  { type: 'load-failed' },
  { type: 'update' },
  { type: 'compact' },
  { type: 'compact-ok' },
  { type: 'compact-rolled-back' },
  { type: 'storage-error' },
  { type: 'reconnect' },
  { type: 'hibernate' },
  { type: 'wake' },
  { type: 'connection', retryDue: true },
  { type: 'connection', retryDue: false },
];

describe('TC-27: the load edges', () => {
  it('Loading → Ready when storage reads clean', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading → Ready even when some updates were quarantined', () => {
    // Quarantine is a count on the result, not a state: a board that opened with
    // a damaged log row set aside is still a board that opened.
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading → LoadFailed when storage could not be read', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });
});

describe('TC-27: the compaction round-trip', () => {
  it('Ready → Compacting → Ready when the fold succeeds', () => {
    const compacting = nextRoomState('ready', { type: 'compact' });
    expect(compacting).toBe('compacting');
    expect(nextRoomState(compacting, { type: 'compact-ok' })).toBe('ready');
  });

  it('Ready → Compacting → Ready when the fold rolls back', () => {
    // A rolled-back compaction is not a failure of the board: the previous
    // snapshot and the whole log are still there, so the room is still ready.
    const compacting = nextRoomState('ready', { type: 'compact' });
    expect(nextRoomState(compacting, { type: 'compact-rolled-back' })).toBe('ready');
  });

  it('a rolled-back compaction that also lost storage goes to StorageFailed', () => {
    expect(nextRoomState('compacting', { type: 'storage-error' })).toBe('storage-failed');
  });
});

describe('TC-27: storage failure and hibernation both reload on the next read', () => {
  it('Ready → StorageFailed → Loading on the next connection', () => {
    const failed = nextRoomState('ready', { type: 'storage-error' });
    expect(failed).toBe('storage-failed');
    expect(nextRoomState(failed, { type: 'reconnect' })).toBe('loading');
  });

  it('Ready → Hibernated → Loading on wake', () => {
    const hibernated = nextRoomState('ready', { type: 'hibernate' });
    expect(hibernated).toBe('hibernated');
    expect(nextRoomState(hibernated, { type: 'wake' })).toBe('loading');
  });
});

describe('TC-27: a LoadFailed room reloads at most once per interval', () => {
  it('stays LoadFailed and closes 4500 before the interval has passed', () => {
    const state: RoomState = 'load-failed';
    const tooSoon: RoomEvent = { type: 'connection', retryDue: false };
    expect(nextRoomState(state, tooSoon)).toBe('load-failed');
    expect(closeCodeFor(state, tooSoon)).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  it('goes to Loading once the interval has passed, and closes nobody then', () => {
    const state: RoomState = 'load-failed';
    const due: RoomEvent = { type: 'connection', retryDue: true };
    expect(nextRoomState(state, due)).toBe('loading');
    // The retry is an attempt to read, not a refusal: it does not close the
    // client it just let in.
    expect(closeCodeFor(state, due)).toBeNull();
  });

  it('a connection to a Ready room is served, not closed', () => {
    const due: RoomEvent = { type: 'connection', retryDue: false };
    expect(nextRoomState('ready', due)).toBe('ready');
    expect(closeCodeFor('ready', due)).toBeNull();
  });
});

describe('TC-27: an event that does not belong to a state leaves it unchanged', () => {
  it('load-ok / load-failed only apply to Loading', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'loading')) {
      expect(nextRoomState(state, { type: 'load-ok' })).toBe(state);
      expect(nextRoomState(state, { type: 'load-failed' })).toBe(state);
    }
  });

  it('update / compact / hibernate only apply to Ready', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'ready')) {
      expect(nextRoomState(state, { type: 'update' })).toBe(state);
      expect(nextRoomState(state, { type: 'compact' })).toBe(state);
      expect(nextRoomState(state, { type: 'hibernate' })).toBe(state);
    }
  });

  it('compact-ok / rolled-back only apply to Compacting', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'compacting')) {
      expect(nextRoomState(state, { type: 'compact-ok' })).toBe(state);
      expect(nextRoomState(state, { type: 'compact-rolled-back' })).toBe(state);
    }
  });

  it('reconnect only applies to StorageFailed; wake only to Hibernated', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'storage-failed')) {
      expect(nextRoomState(state, { type: 'reconnect' })).toBe(state);
    }
    for (const state of ALL_STATES.filter((s) => s !== 'hibernated')) {
      expect(nextRoomState(state, { type: 'wake' })).toBe(state);
    }
  });

  it('no (state, event) pair ever leaves the set of states', () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        expect(ALL_STATES).toContain(nextRoomState(state, event));
      }
    }
  });

  it('no state that is not LoadFailed closes a client with 4500', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'load-failed')) {
      for (const event of ALL_EVENTS) {
        expect(closeCodeFor(state, event)).toBeNull();
      }
    }
  });
});
