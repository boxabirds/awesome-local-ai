import { describe, it, expect } from 'vitest';
import { nextRoomState } from '../../src/worker/room-state';

describe('TC-27: nextRoomState covers every edge of the room state diagram', () => {
  describe('loading state', () => {
    it('loading → ready on load-success', () => {
      expect(nextRoomState('loading', { type: 'load-success', quarantined: 0 })).toBe('ready');
    });

    it('loading → ready on load-success with quarantined', () => {
      expect(nextRoomState('loading', { type: 'load-success', quarantined: 3 })).toBe('ready');
    });

    it('loading → load-failed on load-failed', () => {
      expect(nextRoomState('loading', { type: 'load-failed', error: 'bad' })).toBe('load-failed');
    });

    it('loading stays on invalid events', () => {
      expect(nextRoomState('loading', { type: 'update-stored' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'storage-failed' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'hibernate' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'wake' })).toBe('loading');
      expect(nextRoomState('loading', { type: 'connection' })).toBe('loading');
    });
  });

  describe('ready state', () => {
    it('ready → ready on update-stored', () => {
      expect(nextRoomState('ready', { type: 'update-stored' })).toBe('ready');
    });

    it('ready → storage-failed on storage-failed', () => {
      expect(nextRoomState('ready', { type: 'storage-failed' })).toBe('storage-failed');
    });

    it('ready → hibernated on hibernate', () => {
      expect(nextRoomState('ready', { type: 'hibernate' })).toBe('hibernated');
    });

    it('ready stays on invalid events', () => {
      expect(nextRoomState('ready', { type: 'load-success', quarantined: 0 })).toBe('ready');
      expect(nextRoomState('ready', { type: 'load-failed', error: 'x' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'wake' })).toBe('ready');
      expect(nextRoomState('ready', { type: 'connection' })).toBe('ready');
    });
  });

  describe('storage-failed state', () => {
    it('storage-failed → loading on connection', () => {
      expect(nextRoomState('storage-failed', { type: 'connection' })).toBe('loading');
    });

    it('storage-failed → loading on wake', () => {
      expect(nextRoomState('storage-failed', { type: 'wake' })).toBe('loading');
    });

    it('storage-failed stays on invalid events', () => {
      expect(nextRoomState('storage-failed', { type: 'update-stored' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'hibernate' })).toBe('storage-failed');
      expect(nextRoomState('storage-failed', { type: 'load-success', quarantined: 0 })).toBe('storage-failed');
    });
  });

  describe('load-failed state', () => {
    it('load-failed → loading on connection (after interval, caller checks)', () => {
      expect(nextRoomState('load-failed', { type: 'connection' })).toBe('loading');
    });

    it('load-failed → loading on retry-load', () => {
      expect(nextRoomState('load-failed', { type: 'retry-load' })).toBe('loading');
    });

    it('load-failed stays on invalid events', () => {
      expect(nextRoomState('load-failed', { type: 'update-stored' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'hibernate' })).toBe('load-failed');
      expect(nextRoomState('load-failed', { type: 'storage-failed' })).toBe('load-failed');
    });
  });

  describe('hibernated state', () => {
    it('hibernated → loading on wake', () => {
      expect(nextRoomState('hibernated', { type: 'wake' })).toBe('loading');
    });

    it('hibernated → loading on connection', () => {
      expect(nextRoomState('hibernated', { type: 'connection' })).toBe('loading');
    });

    it('hibernated stays on invalid events', () => {
      expect(nextRoomState('hibernated', { type: 'update-stored' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'storage-failed' })).toBe('hibernated');
      expect(nextRoomState('hibernated', { type: 'hibernate' })).toBe('hibernated');
    });
  });
});
