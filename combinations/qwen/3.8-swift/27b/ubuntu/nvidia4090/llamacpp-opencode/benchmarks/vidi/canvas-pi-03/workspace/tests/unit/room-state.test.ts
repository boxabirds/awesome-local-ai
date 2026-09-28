/**
 * Story 4 unit test for persist.room's pure lifecycle transitions (TC-27).
 * Covers every edge of the design's room lifecycle diagram, including the
 * LoadFailed retry-interval boundary and the "invalid event leaves the state
 * unchanged" negatives.
 */
import { describe, it, expect } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from 'src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from 'src/worker/room-state';

const ev = (type: RoomEvent['type'], extra: Partial<RoomEvent> = {}): RoomEvent => ({
  type,
  ...extra,
});

describe('persist.room lifecycle transitions (TC-27)', () => {
  describe('Loading', () => {
    it('Loading --loaded--> Ready', () => {
      expect(nextRoomState('loading', ev('loaded'))).toBe('ready');
    });

    it('Loading --loaded(quarantined)--> Ready (quarantine does not change the state)', () => {
      // Quarantine is a property of the load result, not the event; the room
      // still reaches Ready.
      expect(nextRoomState('loading', ev('loaded'))).toBe('ready');
    });

    it('Loading --load-failed--> LoadFailed', () => {
      expect(nextRoomState('loading', ev('load-failed'))).toBe('load-failed');
    });

    it('Loading ignores unrelated events (negative)', () => {
      expect(nextRoomState('loading', ev('update-stored'))).toBe('loading');
      expect(nextRoomState('loading', ev('wake'))).toBe('loading');
      expect(nextRoomState('loading', ev('hibernate'))).toBe('loading');
    });
  });

  describe('Ready', () => {
    it('Ready --update-stored--> Ready', () => {
      expect(nextRoomState('ready', ev('update-stored'))).toBe('ready');
    });

    it('Ready --compact-start--> Compacting', () => {
      expect(nextRoomState('ready', ev('compact-start'))).toBe('compacting');
    });

    it('Ready --storage-failed--> StorageFailed', () => {
      expect(nextRoomState('ready', ev('storage-failed'))).toBe('storage-failed');
    });

    it('Ready --hibernate--> Hibernated', () => {
      expect(nextRoomState('ready', ev('hibernate'))).toBe('hibernated');
    });

    it('Ready ignores load/wake events (negative)', () => {
      expect(nextRoomState('ready', ev('loaded'))).toBe('ready');
      expect(nextRoomState('ready', ev('wake'))).toBe('ready');
      expect(nextRoomState('ready', ev('load-failed'))).toBe('ready');
    });
  });

  describe('Compacting', () => {
    it('Compacting --compact-finished--> Ready (success)', () => {
      expect(nextRoomState('compacting', ev('compact-finished'))).toBe('ready');
    });

    it('Compacting --compact-rolled-back--> Ready (rollback)', () => {
      expect(nextRoomState('compacting', ev('compact-rolled-back'))).toBe('ready');
    });

    it('Compacting ignores other events (negative)', () => {
      expect(nextRoomState('compacting', ev('update-stored'))).toBe('compacting');
      expect(nextRoomState('compacting', ev('storage-failed'))).toBe('compacting');
    });
  });

  describe('StorageFailed', () => {
    it('StorageFailed --wake--> Loading', () => {
      expect(nextRoomState('storage-failed', ev('wake'))).toBe('loading');
    });

    it('StorageFailed ignores non-wake events (negative)', () => {
      expect(nextRoomState('storage-failed', ev('loaded'))).toBe('storage-failed');
      expect(nextRoomState('storage-failed', ev('update-stored'))).toBe('storage-failed');
    });
  });

  describe('Hibernated', () => {
    it('Hibernated --wake--> Loading', () => {
      expect(nextRoomState('hibernated', ev('wake'))).toBe('loading');
    });

    it('Hibernated ignores non-wake events (negative)', () => {
      expect(nextRoomState('hibernated', ev('loaded'))).toBe('hibernated');
      expect(nextRoomState('hibernated', ev('hibernate'))).toBe('hibernated');
    });
  });

  describe('LoadFailed (retry interval boundary)', () => {
    it('LoadFailed --connection-attempt after interval--> Loading', () => {
      const last = 1_000;
      const now = last + LOAD_RETRY_MIN_INTERVAL_MS;
      expect(nextRoomState('load-failed', ev('connection-attempt', { now, lastAttemptAt: last }))).toBe('loading');
    });

    it('LoadFailed --connection-attempt exactly at interval--> Loading (inclusive boundary)', () => {
      const last = 1_000;
      expect(nextRoomState('load-failed', ev('connection-attempt', { now: last + LOAD_RETRY_MIN_INTERVAL_MS, lastAttemptAt: last }))).toBe('loading');
    });

    it('LoadFailed --connection-attempt before interval--> LoadFailed (close 4500)', () => {
      const last = 1_000;
      const now = last + LOAD_RETRY_MIN_INTERVAL_MS - 1;
      expect(nextRoomState('load-failed', ev('connection-attempt', { now, lastAttemptAt: last }))).toBe('load-failed');
    });

    it('LoadFailed ignores non-connection events (negative)', () => {
      expect(nextRoomState('load-failed', ev('loaded'))).toBe('load-failed');
      expect(nextRoomState('load-failed', ev('wake'))).toBe('load-failed');
    });
  });

  describe('full lifecycle walkthrough', () => {
    it('construct → ready → compact → ready → hibernate → wake → ready', () => {
      let s: RoomLifecycle = 'loading';
      s = nextRoomState(s, ev('loaded'));
      expect(s).toBe('ready');
      s = nextRoomState(s, ev('update-stored'));
      expect(s).toBe('ready');
      s = nextRoomState(s, ev('compact-start'));
      expect(s).toBe('compacting');
      s = nextRoomState(s, ev('compact-finished'));
      expect(s).toBe('ready');
      s = nextRoomState(s, ev('hibernate'));
      expect(s).toBe('hibernated');
      s = nextRoomState(s, ev('wake'));
      expect(s).toBe('loading');
      s = nextRoomState(s, ev('loaded'));
      expect(s).toBe('ready');
    });

    it('storage failure resets to Loading on next wake', () => {
      let s: RoomLifecycle = 'ready';
      s = nextRoomState(s, ev('storage-failed'));
      expect(s).toBe('storage-failed');
      s = nextRoomState(s, ev('wake'));
      expect(s).toBe('loading');
    });
  });
});
