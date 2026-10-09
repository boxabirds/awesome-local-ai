import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BOARD_LOAD_TIMEOUT_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { canEdit, connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { clearSockets, socketCount, socketsCloseWith, socketsLive } from './fixtures/socket';

/**
 * The close-code mapping the badge is built on, driven by the fake room of the
 * component fixtures (`connection-close` events, exactly as they arrive on the wire).
 * Design's "fake provider emitting `connection-close`" row, TC-28: 4500 →
 * `load_failed`; 1011 → `reconnecting` with editing still enabled; 1003 likewise;
 * and the first sync after a `load_failed` is the whole recovery — `connected`,
 * editing enabled, page never reloaded.
 */

class Board {
  readonly seen: ConnectionState[] = [];
  readonly conn = connectBoard(new Y.Doc(), 'a-board', (state) => {
    this.seen.push(state);
  });

  get last(): ConnectionState | undefined {
    return this.seen[this.seen.length - 1];
  }

  async live(): Promise<void> {
    await socketsLive();
  }

  async reopen(): Promise<void> {
    // `BoardSocket` retries with backoff; the first retry is due 200 ms after the
    // close and `vi.waitFor` polls until the new socket exists, then opens it.
    await vi.waitFor(async () => {
      if (socketCount() < 2) throw new Error('no retry socket yet');
      await socketsLive();
    });
  }

  destroy(): void {
    this.conn.destroy();
  }
}

describe('the close codes the badge tells apart (TC-28)', () => {
  beforeEach(() => {
    // Every socket this file sees belongs to the test counting it.
    clearSockets();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls a storage failure reconnecting, and keeps the board editable', async () => {
    const board = new Board();
    try {
      await board.live();
      expect(board.last).toBe('connected');
      socketsCloseWith(CLOSE_STORAGE_FAILURE); // 1011: the room lost its doc, not the board
      expect(board.last).toBe('reconnecting');
      expect(canEdit(board.last ?? 'connecting')).toBe(true);
    } finally {
      board.destroy();
    }
  });

  it('calls any other close reconnecting too, never a load failure', async () => {
    const board = new Board();
    try {
      await board.live();
      socketsCloseWith(1003); // the sender was refused; the board is none the worse
      expect(board.last).toBe('reconnecting');
      expect(canEdit(board.last ?? 'connecting')).toBe(true);
    } finally {
      board.destroy();
    }
  });

  it('calls 4500 load_failed, and a later sync is the whole recovery', async () => {
    const board = new Board();
    try {
      await board.live();
      socketsCloseWith(CLOSE_BOARD_LOAD_FAILED);
      expect(board.last).toBe('load_failed');
      expect(canEdit(board.last ?? 'connecting')).toBe(false);

      // Recovery, no reload: the retry loop keeps trying, and the first sync after
      // the room's failed load says the board is real after all.
      await board.reopen();
      expect(board.last).toBe('connected');
      expect(canEdit(board.last ?? 'connecting')).toBe(true);
    } finally {
      board.destroy();
    }
  });

  it('calls a connection that never opened a load failure once the load budget is spent', async () => {
    // The other road to the same badge: an upgrade that hangs — a load holding the
    // connection — is indistinguishable from a broken board, so after
    // `BOARD_LOAD_TIMEOUT_MS` it is said as one. (Fake timers: this is a boundary
    // value, and waiting for it in real time proves nothing about it.)
    vi.useFakeTimers();
    const board = new Board();
    try {
      // The socket exists and stays unopened: the room never answers anything.
      expect(socketCount()).toBe(1);
      vi.advanceTimersByTime(BOARD_LOAD_TIMEOUT_MS - 1);
      expect(board.seen).not.toContain('load_failed');
      vi.advanceTimersByTime(1);
      expect(board.last).toBe('load_failed');
    } finally {
      board.destroy();
    }
  });
});
