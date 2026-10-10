import { describe, expect, it } from 'vitest';
import { nextRoomState, type RoomEvent, type RoomLifecycleState } from '../../src/worker/room-state';

const ALL_EVENTS: RoomEvent[] = [
  { type: 'load-ok' },
  { type: 'load-ok-quarantined' },
  { type: 'load-failed' },
  { type: 'compact' },
  { type: 'compact-ok' },
  { type: 'compact-failed' },
  { type: 'storage-error' },
  { type: 'reset' },
  { type: 'hibernate' },
  { type: 'wake' },
  { type: 'connection', retryAllowed: true },
  { type: 'connection', retryAllowed: false }
];

// Every edge of the design's lifecycle diagram (TC-27).
describe('nextRoomState (TC-27)', () => {
  it('Loading → Ready on load-ok', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading → Ready on load-ok-quarantined', () => {
    expect(nextRoomState('loading', { type: 'load-ok-quarantined' })).toBe('ready');
  });

  it('Loading → LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('Ready → Compacting on compact', () => {
    expect(nextRoomState('ready', { type: 'compact' })).toBe('compacting');
  });

  it('Compacting → Ready on compact-ok (success)', () => {
    expect(nextRoomState('compacting', { type: 'compact-ok' })).toBe('ready');
  });

  it('Compacting → Ready on compact-failed (rollback keeps serving)', () => {
    expect(nextRoomState('compacting', { type: 'compact-failed' })).toBe('ready');
  });

  it('Ready → StorageFailed on storage-error', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  it('StorageFailed → Loading on reset', () => {
    expect(nextRoomState('storage-failed', { type: 'reset' })).toBe('loading');
  });

  it('Ready → Hibernated on hibernate', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  it('Hibernated → Loading on wake', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('LoadFailed → Loading on a connection once the retry interval elapsed', () => {
    expect(nextRoomState('load-failed', { type: 'connection', retryAllowed: true })).toBe('loading');
  });

  it('LoadFailed stays LoadFailed on a connection before the retry interval', () => {
    expect(nextRoomState('load-failed', { type: 'connection', retryAllowed: false })).toBe(
      'load-failed'
    );
  });

  it.each([
    ['loading', 'connection', { type: 'connection', retryAllowed: true }],
    ['ready', 'load-ok', { type: 'load-ok' }],
    ['compacting', 'storage-error', { type: 'storage-error' }],
    ['storage-failed', 'connection', { type: 'connection', retryAllowed: true }],
    ['hibernated', 'load-ok', { type: 'load-ok' }],
    ['load-failed', 'load-ok', { type: 'load-ok' }]
  ] as Array<[RoomLifecycleState, string, RoomEvent]>)(
    'invalid event %s for state %s leaves it unchanged',
    (state, _label, event) => {
      expect(nextRoomState(state, event)).toBe(state);
    }
  );

  it('only the listed events change each state (exhaustive negative sweep)', () => {
    const transitions: Record<RoomLifecycleState, Set<string>> = {
      loading: new Set(['load-ok', 'load-ok-quarantined', 'load-failed']),
      ready: new Set(['compact', 'storage-error', 'hibernate']),
      compacting: new Set(['compact-ok', 'compact-failed']),
      'storage-failed': new Set(['reset']),
      hibernated: new Set(['wake']),
      'load-failed': new Set(['connection'])
    };
    const states = Object.keys(transitions) as RoomLifecycleState[];
    for (const state of states) {
      for (const event of ALL_EVENTS) {
        const next = nextRoomState(state, event);
        if (!transitions[state].has(event.type)) {
          expect(next, `${state} + ${event.type}`).toBe(state);
        }
      }
    }
  });
});
