import { describe, it, expect } from 'vitest';
import { nextRoomState, type LifecycleState } from '../../src/worker/room-state';

describe('TC-27: nextRoomState — every edge of the room lifecycle diagram', () => {
  it('Loading -> Ready on load-ok', () => {
    expect(nextRoomState('loading', { type: 'load-ok' })).toBe('ready');
  });

  it('Loading -> Ready on load-quarantined (damaged rows quarantined, rest applied)', () => {
    expect(nextRoomState('loading', { type: 'load-quarantined' })).toBe('ready');
  });

  it('Loading -> LoadFailed on load-failed', () => {
    expect(nextRoomState('loading', { type: 'load-failed' })).toBe('load-failed');
  });

  it('Ready -> Ready on update', () => {
    expect(nextRoomState('ready', { type: 'update' })).toBe('ready');
  });

  it('Ready -> Compacting on compact', () => {
    expect(nextRoomState('ready', { type: 'compact' })).toBe('compacting');
  });

  it('Compacting -> Ready on compact-ok', () => {
    expect(nextRoomState('compacting', { type: 'compact-ok' })).toBe('ready');
  });

  it('Compacting -> Ready on compact-error (rolled back, log intact)', () => {
    expect(nextRoomState('compacting', { type: 'compact-error' })).toBe('ready');
  });

  it('Ready -> StorageFailed on storage-error', () => {
    expect(nextRoomState('ready', { type: 'storage-error' })).toBe('storage-failed');
  });

  it('StorageFailed -> Loading on reload (next connection)', () => {
    expect(nextRoomState('storage-failed', { type: 'reload' })).toBe('loading');
  });

  it('Ready -> Hibernated on hibernate', () => {
    expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
  });

  it('Hibernated -> Loading on wake', () => {
    expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
  });

  it('LoadFailed -> Loading on retry after the interval elapsed', () => {
    expect(nextRoomState('load-failed', { type: 'retry', elapsed: true })).toBe('loading');
  });

  it('LoadFailed -> LoadFailed on retry before the interval (stays, closed 4500)', () => {
    expect(nextRoomState('load-failed', { type: 'retry', elapsed: false })).toBe('load-failed');
  });
});

describe('TC-27 negative: invalid events leave the state unchanged', () => {
  const invalid: Array<[LifecycleState, Parameters<typeof nextRoomState>[1]]> = [
    ['loading', { type: 'update' }],
    ['loading', { type: 'storage-error' }],
    ['loading', { type: 'compact' }],
    ['loading', { type: 'wake' }],
    ['loading', { type: 'retry', elapsed: true }],
    ['ready', { type: 'load-ok' }],
    ['ready', { type: 'reload' }],
    ['ready', { type: 'wake' }],
    ['ready', { type: 'compact-ok' }],
    ['ready', { type: 'retry', elapsed: true }],
    ['compacting', { type: 'storage-error' }],
    ['compacting', { type: 'update' }],
    ['compacting', { type: 'hibernate' }],
    ['storage-failed', { type: 'wake' }],
    ['storage-failed', { type: 'update' }],
    ['storage-failed', { type: 'load-ok' }],
    ['hibernated', { type: 'update' }],
    ['hibernated', { type: 'load-ok' }],
    ['hibernated', { type: 'storage-error' }],
    ['load-failed', { type: 'update' }],
    ['load-failed', { type: 'compact' }],
    ['load-failed', { type: 'load-ok' }],
    ['load-failed', { type: 'wake' }],
    ['load-failed', { type: 'storage-error' }],
  ];

  for (const [state, event] of invalid) {
    it(`${state} unchanged on ${event.type}`, () => {
      expect(nextRoomState(state, event)).toBe(state);
    });
  }
});
