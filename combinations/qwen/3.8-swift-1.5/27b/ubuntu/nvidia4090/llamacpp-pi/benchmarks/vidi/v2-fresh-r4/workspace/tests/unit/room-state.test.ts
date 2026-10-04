import { describe, it, expect } from 'vitest';
import { nextRoomState, type RoomState, type RoomEvent } from '../../src/worker/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

/**
 * TC-27: every edge of the room state diagram, plus invalid events.
 *
 * Diagram edges:
 *   Loading → Ready (snapshot and log applied)
 *   Loading → Ready (log rows quarantined, rest applied)
 *   Loading → LoadFailed (snapshot unreadable or SQL error)
 *   Ready → Ready (update applied, stored, broadcast)
 *   Ready → Compacting (log exceeds threshold)
 *   Compacting → Ready (snapshot replaced, log truncated)
 *   Compacting → Ready (compaction error rolled back, log intact)
 *   Ready → StorageFailed (insert throws)
 *   StorageFailed → Loading (sockets closed, doc discarded, next connection)
 *   Ready → Hibernated (no events)
 *   Hibernated → Loading (message or new connection wakes object)
 *   LoadFailed → Loading (new connection after LOAD_RETRY_MIN_INTERVAL_MS)
 *   LoadFailed → LoadFailed (connection before the interval: closed 4500)
 */

const T0 = 1_000_000;

describe('TC-27: room state transitions', () => {
  describe('Loading', () => {
    const loading: RoomState = { name: 'loading' };

    it('load-success (clean) → ready', () => {
      const next = nextRoomState(loading, { type: 'load-success', quarantined: 0 });
      expect(next.name).toBe('ready');
    });

    it('load-success (rows quarantined) → ready', () => {
      const next = nextRoomState(loading, { type: 'load-success', quarantined: 3 });
      expect(next.name).toBe('ready');
    });

    it('load-failed → load-failed with timestamp', () => {
      const next = nextRoomState(loading, { type: 'load-failed', atMs: T0 });
      expect(next).toEqual({ name: 'load-failed', sinceMs: T0 });
    });
  });

  describe('Ready', () => {
    const ready: RoomState = { name: 'ready' };

    it('update stays ready', () => {
      const next = nextRoomState(ready, { type: 'update' });
      expect(next.name).toBe('ready');
    });

    it('compact-start → compacting', () => {
      const next = nextRoomState(ready, { type: 'compact-start' });
      expect(next.name).toBe('compacting');
    });

    it('storage-failed → storage-failed', () => {
      const next = nextRoomState(ready, { type: 'storage-failed' });
      expect(next.name).toBe('storage-failed');
    });

    it('hibernate → hibernated', () => {
      const next = nextRoomState(ready, { type: 'hibernate' });
      expect(next.name).toBe('hibernated');
    });
  });

  describe('Compacting', () => {
    const compacting: RoomState = { name: 'compacting' };

    it('compact-success → ready (snapshot replaced, log truncated)', () => {
      const next = nextRoomState(compacting, { type: 'compact-success' });
      expect(next.name).toBe('ready');
    });

    it('compact-failed → ready (rolled back, log intact)', () => {
      const next = nextRoomState(compacting, { type: 'compact-failed' });
      expect(next.name).toBe('ready');
    });
  });

  describe('StorageFailed', () => {
    const storageFailed: RoomState = { name: 'storage-failed' };

    it('wake → loading (next connection reloads)', () => {
      const next = nextRoomState(storageFailed, { type: 'wake' });
      expect(next.name).toBe('loading');
    });
  });

  describe('Hibernated', () => {
    const hibernated: RoomState = { name: 'hibernated' };

    it('wake → loading (message or new connection wakes object)', () => {
      const next = nextRoomState(hibernated, { type: 'wake' });
      expect(next.name).toBe('loading');
    });
  });

  describe('LoadFailed', () => {
    const loadFailed: RoomState = { name: 'load-failed', sinceMs: T0 };

    it('connection after LOAD_RETRY_MIN_INTERVAL_MS → loading (retry)', () => {
      const next = nextRoomState(loadFailed, { type: 'connection', nowMs: T0 + LOAD_RETRY_MIN_INTERVAL_MS });
      expect(next.name).toBe('loading');
    });

    it('connection just after the interval → loading', () => {
      const next = nextRoomState(loadFailed, { type: 'connection', nowMs: T0 + LOAD_RETRY_MIN_INTERVAL_MS + 1 });
      expect(next.name).toBe('loading');
    });

    it('connection before the interval stays load-failed (closed 4500)', () => {
      const next = nextRoomState(loadFailed, { type: 'connection', nowMs: T0 + LOAD_RETRY_MIN_INTERVAL_MS - 1 });
      expect(next).toBe(loadFailed);
    });

    it('connection at exactly the failed time stays load-failed', () => {
      const next = nextRoomState(loadFailed, { type: 'connection', nowMs: T0 });
      expect(next).toBe(loadFailed);
    });
  });

  describe('invalid events leave state unchanged', () => {
    it('loading: update/compact/wake/connection are invalid', () => {
      const s: RoomState = { name: 'loading' };
      for (const e of [
        { type: 'update' },
        { type: 'compact-start' },
        { type: 'compact-success' },
        { type: 'wake' },
        { type: 'connection', nowMs: T0 },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });

    it('ready: load-success/load-failed/compact-end/wake are invalid', () => {
      const s: RoomState = { name: 'ready' };
      for (const e of [
        { type: 'load-success', quarantined: 0 },
        { type: 'load-failed', atMs: T0 },
        { type: 'compact-success' },
        { type: 'compact-failed' },
        { type: 'wake' },
        { type: 'connection', nowMs: T0 },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });

    it('compacting: update/storage-failed/hibernate/wake are invalid', () => {
      const s: RoomState = { name: 'compacting' };
      for (const e of [
        { type: 'update' },
        { type: 'storage-failed' },
        { type: 'hibernate' },
        { type: 'wake' },
        { type: 'connection', nowMs: T0 },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });

    it('storage-failed: update/hibernate/load-success are invalid', () => {
      const s: RoomState = { name: 'storage-failed' };
      for (const e of [
        { type: 'update' },
        { type: 'hibernate' },
        { type: 'load-success', quarantined: 0 },
        { type: 'connection', nowMs: T0 },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });

    it('hibernated: update/storage-failed/hibernate are invalid', () => {
      const s: RoomState = { name: 'hibernated' };
      for (const e of [
        { type: 'update' },
        { type: 'storage-failed' },
        { type: 'hibernate' },
        { type: 'connection', nowMs: T0 },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });

    it('load-failed: update/wake/storage-failed are invalid', () => {
      const s: RoomState = { name: 'load-failed', sinceMs: T0 };
      for (const e of [
        { type: 'update' },
        { type: 'wake' },
        { type: 'storage-failed' },
        { type: 'hibernate' },
      ] as RoomEvent[]) {
        expect(nextRoomState(s, e)).toBe(s);
      }
    });
  });
});
