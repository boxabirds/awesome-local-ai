/**
 * TC-27: Unit tests for nextRoomState — every edge of the room state diagram
 * plus invalid events that must leave state unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  nextRoomState,
  canRetryLoad,
  type RoomState,
  type RoomEvent,
} from '@/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';

describe('TC-27: room state transitions', () => {
  // Helper to check a transition without assertions on the event details
  function transition(current: string, eventKind: string): string {
    const event = { kind: eventKind } as RoomEvent;
    return nextRoomState(current as any, event);
  }

  // ---- Loading transitions ----
  describe('_loading →', () => {
    it('load-ok → ready', () => {
      expect(transition('_loading', 'load-ok')).toBe('ready');
    });

    it('load-ok-quarantined → ready', () => {
      expect(transition('_loading', 'load-ok-quarantined')).toBe('ready');
    });

    it('load-error-reason → load-failed', () => {
      expect(transition('_loading', 'load-error-reason')).toBe('load-failed');
    });

    it('load-error-sql → load-failed', () => {
      expect(transition('_loading', 'load-error-sql')).toBe('load-failed');
    });
  });

  // ---- Ready transitions ----
  describe('ready →', () => {
    it('append-success → _compacting', () => {
      expect(transition('ready', 'append-success')).toBe('_compacting');
    });

    it('any other event → stays ready', () => {
      expect(transition('ready', 'load-ok')).toBe('ready');
      expect(transition('ready', 'load-error-reason')).toBe('ready');
      expect(transition('ready', 'compact-ok')).toBe('ready');
      expect(transition('ready', 'append-error')).toBe('ready');
    });
  });

  // ---- Compacting transitions ----
  describe('_compacting →', () => {
    it('compact-ok → ready', () => {
      expect(transition('_compacting', 'compact-ok')).toBe('ready');
    });

    it('compact-failed → ready (rolled back)', () => {
      expect(transition('_compacting', 'compact-failed')).toBe('ready');
    });

    it('invalid event → stays compacting', () => {
      expect(transition('_compacting', 'load-ok')).toBe('_compacting');
    });
  });

  // ---- LoadFailed transitions ----
  describe('load-failed → no direct transitions (caller handles retry timing)', () => {
    it('any event → stays load-failed', () => {
      expect(transition('load-failed', 'load-ok')).toBe('load-failed');
      expect(transition('load-failed', 'append-success')).toBe('load-failed');
      expect(transition('load-failed', 'new-connection')).toBe('load-failed');
    });
  });

  // ---- StorageFailed transitions ----
  describe('storage-failed →', () => {
    it('socket-closed → _loading', () => {
      expect(transition('storage-failed', 'socket-closed')).toBe('_loading');
    });

    it('any other event → stays storage-failed', () => {
      expect(transition('storage-failed', 'append-success')).toBe('storage-failed');
      expect(transition('storage-failed', 'load-ok')).toBe('storage-failed');
    });
  });

  // ---- Invalid events in valid states leave state unchanged ----
  describe('invalid events are idempotent', () => {
    for (const [state, invalid] of [
      ['_loading' as const, ['new-connection', 'append-error'] as const],
      ['ready' as const, ['load-ok', 'load-error-reason', 'compact-ok', 'append-error', 'new-connection', 'socket-closed'] as const],
      ['_compacting' as const, ['load-ok', 'append-error', 'new-connection', 'socket-closed'] as const],
      ['load-failed' as const, ['load-ok', 'append-success', 'new-connection', 'socket-closed', 'append-error'] as const],
      ['storage-failed' as const, ['load-ok', 'append-success', 'compact-ok', 'append-error', 'new-connection'] as const],
    ] as const) {
      for (const eventKind of invalid) {
        it(`${state} + ${eventKind} → ${state}`, () => {
          expect(transition(state, eventKind)).toBe(state);
        });
      }
    }
  });

  // ---- Unknown state stays unknown ----
  it('unknown state → itself', () => {
    expect(nextRoomState('_foobar' as any, { kind: 'load-ok' })).toBe('_foobar');
  });

  // ---- canRetryLoad boundary ----
  describe('canRetryLoad', () => {
    it('below interval → false', () => {
      expect(canRetryLoad(0)).toBe(false);
      expect(canRetryLoad(4999)).toBe(false);
    });

    it('at exactly interval → true', () => {
      expect(canRetryLoad(LOAD_RETRY_MIN_INTERVAL_MS)).toBe(true);
    });

    it('above interval → true', () => {
      expect(canRetryLoad(5001)).toBe(true);
      expect(canRetryLoad(10000)).toBe(true);
    });
  });
});
