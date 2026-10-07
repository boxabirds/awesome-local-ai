import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/shared/room-state';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

// TC-27: nextRoomState covers every edge of the room lifecycle diagram + invalid events
describe('TC-27: nextRoomState state transitions', () => {
  const NOW = Date.now();

  // ---------- Loading transitions ----------
  describe('loading → ready', () => {
    it('load-ok → ready', () => {
      expect(nextRoomState('loading', 'load-ok')).toBe('ready');
    });

    it('load-ok-quarantined → ready', () => {
      expect(nextRoomState('loading', 'load-ok-quarantined')).toBe('ready');
    });
  });

  describe('loading → load-failed', () => {
    it('load-error → load-failed', () => {
      expect(nextRoomState('loading', 'load-error')).toBe('load-failed');
    });

    it('sql-error → load-failed', () => {
      expect(nextRoomState('loading', 'sql-error')).toBe('load-failed');
    });
  });

  describe('loading → loading (invalid)', () => {
    it('random event stays loading', () => {
      expect(nextRoomState('loading', 'nonsense')).toBe('loading');
    });
    it('append-success while loading stays loading', () => {
      expect(nextRoomState('loading', 'append-success')).toBe('loading');
    });
  });

  // ---------- Ready transitions ----------
  describe('ready → ready', () => {
    it('append-success → ready', () => {
      expect(nextRoomState('ready', 'append-success')).toBe('ready');
    });
  });

  describe('ready → compacting', () => {
    it('compact-request → compacting', () => {
      expect(nextRoomState('ready', 'compact-request')).toBe('compacting');
    });
  });

  describe('ready → storage-failed', () => {
    it('append-failed → storage-failed', () => {
      expect(nextRoomState('ready', 'append-failed')).toBe('storage-failed');
    });
  });

  describe('ready → ready (invalid)', () => {
    it('nonsense event stays ready', () => {
      expect(nextRoomState('ready', 'nonsense')).toBe('ready');
    });
    it('load-ok while ready stays ready', () => {
      expect(nextRoomState('ready', 'load-ok')).toBe('ready');
    });
  });

  // ---------- Compacting transitions ----------
  describe('compacting → ready', () => {
    it('compaction-ok → ready', () => {
      expect(nextRoomState('compacting', 'compaction-ok')).toBe('ready');
    });

    it('compaction-rollback → ready', () => {
      expect(nextRoomState('compacting', 'compaction-rollback')).toBe('ready');
    });
  });

  describe('compacting → compacting (invalid)', () => {
    it('append-success while compacting stays compacting', () => {
      expect(nextRoomState('compacting', 'append-success')).toBe('compacting');
    });
  });

  // ---------- Storage-failed transitions ----------
  describe('storage-failed → loading', () => {
    it('reset-done → loading', () => {
      expect(nextRoomState('storage-failed', 'reset-done')).toBe('loading');
    });
  });

  describe('storage-failed → storage-failed (invalid)', () => {
    it('nonsense event stays storage-failed', () => {
      expect(nextRoomState('storage-failed', 'nonsense')).toBe('storage-failed');
    });
  });

  // ---------- Load-failed transitions ----------
  describe('load-failed → load-failed (before interval)', () => {
    it('close-4500 before timeout stays load-failed', () => {
      const result = nextRoomState(
        'load-failed',
        'retry-after-interval',
        { now: NOW, failedAt: NOW - 1000 }, // only 1s elapsed
      );
      expect(result).toBe('load-failed');
    });

    it('any event before timeout keeps load-failed', () => {
      const result = nextRoomState('load-failed', 'nonsense');
      expect(result).toBe('load-failed');
    });
  });

  describe('load-failed → loading (after interval)', () => {
    it('retry-after-interval after LOAD_RETRY_MIN_INTERVAL_MS → loading', () => {
      const result = nextRoomState(
        'load-failed',
        'retry-after-interval',
        { now: NOW, failedAt: NOW - LOAD_RETRY_MIN_INTERVAL_MS - 1 },
      );
      expect(result).toBe('loading');
    });

    it('exactly at interval boundary → loading', () => {
      const result = nextRoomState(
        'load-failed',
        'retry-after-interval',
        { now: NOW, failedAt: NOW - LOAD_RETRY_MIN_INTERVAL_MS },
      );
      expect(result).toBe('loading');
    });
  });

  describe('load-failed → load-failed (no extra data)', () => {
    it('without extra object, retry-after-interval stays load-failed', () => {
      const result = nextRoomState('load-failed', 'retry-after-interval');
      expect(result).toBe('load-failed');
    });
  });
});
