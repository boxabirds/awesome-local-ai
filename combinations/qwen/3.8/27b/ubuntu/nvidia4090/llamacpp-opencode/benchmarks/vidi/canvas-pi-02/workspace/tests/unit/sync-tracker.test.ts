/**
 * TC-08: classifyFrame for SyncStep1, SyncStep2, Update, awareness, ack, string.
 * TC-09: tracker state machine with sends, acks, disconnect, reconnect.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyFrame, createSyncTracker } from '../../src/client/offline/syncTracker';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_SYNC_ACK } from '../../src/shared/protocol';

// Helpers to build frames.
function syncFrame(syncType: number): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const bytes = new Uint8Array(buf);
  bytes[0] = MESSAGE_SYNC;
  bytes[1] = syncType;
  return buf;
}

function awarenessFrame(): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const bytes = new Uint8Array(buf);
  bytes[0] = MESSAGE_AWARENESS;
  bytes[1] = 0;
  return buf;
}

function ackFrame(count: number): ArrayBuffer {
  const buf = new ArrayBuffer(2);
  const bytes = new Uint8Array(buf);
  bytes[0] = MESSAGE_SYNC_ACK;
  bytes[1] = count;
  return buf;
}

// y-protocols sync message types:
// SYNC_STEP_1 = 0, SYNC_STEP_2 = 1, UPDATE = 2

describe('TC-08: classifyFrame', () => {
  it('SyncStep1 → other', () => {
    expect(classifyFrame(syncFrame(0))).toBe('other');
  });

  it('SyncStep2 → data', () => {
    expect(classifyFrame(syncFrame(1))).toBe('data');
  });

  it('Update → data', () => {
    expect(classifyFrame(syncFrame(2))).toBe('data');
  });

  it('awareness → other', () => {
    expect(classifyFrame(awarenessFrame())).toBe('other');
  });

  it('MESSAGE_SYNC_ACK → other', () => {
    expect(classifyFrame(ackFrame(1))).toBe('other');
  });

  it('string frame → other', () => {
    expect(classifyFrame('hello')).toBe('other');
  });
});

describe('TC-09: sync tracker state machine', () => {
  it('starts synced when initiallyUnsynced is false', () => {
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag: vi.fn(),
    });
    expect(tracker.state()).toBe('synced');
  });

  it('starts pending_offline when initiallyUnsynced is true', () => {
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: true,
      persistFlag: vi.fn(),
    });
    expect(tracker.state()).toBe('pending_offline');
  });

  it('onLocalChange while connected → syncing, persistFlag(true) once', () => {
    const persistFlag = vi.fn().mockResolvedValue(undefined);
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag,
    });

    // Simulate being connected.
    tracker.onConnected();
    expect(tracker.state()).toBe('synced');

    tracker.onLocalChange();
    expect(tracker.state()).toBe('syncing');
    expect(persistFlag).toHaveBeenCalledWith(true);
    expect(persistFlag).toHaveBeenCalledTimes(1);
  });

  it('3 sends, acks 1 and 2 → syncing; ack 3 → synced, persistFlag(false)', () => {
    const persistFlag = vi.fn().mockResolvedValue(undefined);
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag,
    });

    tracker.onConnected();

    // 3 data frame sends.
    tracker.onSend(syncFrame(2));
    tracker.onSend(syncFrame(2));
    tracker.onSend(syncFrame(2));
    expect(tracker.state()).toBe('syncing');

    // Ack 1.
    tracker.onAck(1);
    expect(tracker.state()).toBe('syncing');

    // Ack 2.
    tracker.onAck(2);
    expect(tracker.state()).toBe('syncing');

    // Ack 3 → synced.
    tracker.onAck(3);
    expect(tracker.state()).toBe('synced');
    expect(persistFlag).toHaveBeenCalledWith(false);
  });

  it('onDisconnected with unsynced → pending_offline, counters reset', () => {
    const persistFlag = vi.fn().mockResolvedValue(undefined);
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag,
    });

    tracker.onConnected();
    tracker.onSend(syncFrame(2));
    expect(tracker.state()).toBe('syncing');

    tracker.onDisconnected();
    expect(tracker.state()).toBe('pending_offline');

    // New connection: counters reset.
    tracker.onConnected();
    // No sends, no acks → synced (since we reset counters).
    // But we were pending_offline, so...
    // Actually after onConnected, if sent=0 and acked=0, and state was pending_offline,
    // it should stay pending_offline until the handshake completes.
    expect(tracker.state()).toBe('pending_offline');
  });

  it('ack greater than sent → clamped, state not corrupted', () => {
    const persistFlag = vi.fn().mockResolvedValue(undefined);
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag,
    });

    tracker.onConnected();
    tracker.onSend(syncFrame(2));
    expect(tracker.state()).toBe('syncing');

    // Ack way more than sent.
    tracker.onAck(999);
    // Should be clamped to sent (1), so synced.
    expect(tracker.state()).toBe('synced');
  });

  it('hasUnsynced reflects state', () => {
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: false,
      persistFlag: vi.fn().mockResolvedValue(undefined),
    });

    tracker.onConnected();
    expect(tracker.hasUnsynced()).toBe(false);

    tracker.onSend(syncFrame(2));
    expect(tracker.hasUnsynced()).toBe(true);

    tracker.onAck(1);
    expect(tracker.hasUnsynced()).toBe(false);
  });

  it('initiallyUnsynced: after onConnected + handshake send + ack → synced', () => {
    const persistFlag = vi.fn().mockResolvedValue(undefined);
    const tracker = createSyncTracker({
      boardId: 'b1',
      initiallyUnsynced: true,
      persistFlag,
    });
    expect(tracker.state()).toBe('pending_offline');

    tracker.onConnected();
    // Handshake: provider sends SyncStep2 with device changes.
    tracker.onSend(syncFrame(1)); // SyncStep2
    expect(tracker.state()).toBe('syncing');

    tracker.onAck(1);
    expect(tracker.state()).toBe('synced');
    expect(persistFlag).toHaveBeenCalledWith(false);
  });
});
