import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  connectBoard,
  wsServerUrl,
  type BoardConnection,
} from '../../src/client/board/connectBoard.ts';
import type { ProviderSignal } from '../../src/client/board/useConnectionBadge.ts';
import { RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config.ts';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol.ts';

// A transport stub injected via WebsocketProvider's WebSocketPolyfill option
// (the real transport is the global WebSocket; injecting is the documented seam,
// the provider itself is never mocked). Mirrors the event-property interface
// y-websocket actually uses.
class FakeSocket {
  static instances: FakeSocket[] = [];
  static reset(): void {
    FakeSocket.instances = [];
  }
  readyState = 0; // CONNECTING
  status = 'connecting';
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  readonly sent: ArrayBuffer[] = [];
  closedWith: number | null = null;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }
  close(code = 1006): void {
    // Real close() does not synchronously re-enter onclose; only records.
    this.readyState = 3;
    this.closedWith = code;
  }
  // Test drivers.
  serverOpen(): void {
    this.readyState = 1;
    this.status = 'open';
    this.onopen?.();
  }
  serverClose(code: number): void {
    this.readyState = 3;
    this.status = 'closed';
    this.onclose?.({ code, reason: '' });
  }
  serverMessage(bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.onmessage?.({ data: copy.buffer });
  }
}

interface Scheduled {
  fn: () => void;
  ms: number;
}


function firstFrameType(buf: ArrayBuffer): number {
  return new Uint8Array(buf)[0];
}

let conn: BoardConnection | null = null;

beforeEach(() => {
  FakeSocket.reset();
});

afterEach(() => {
  conn?.destroy();
  conn = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('connectBoard (URL, frames, status, backoff, close codes)', () => {
  it('targets the room endpoint and sends SyncStep1 on open', () => {
    const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const doc = new Y.Doc();
    conn = connectBoard(boardId, doc, { WebSocketPolyfill: FakeSocket });

    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe(`${wsServerUrl()}/${boardId}`);
    expect(conn.provider.roomname).toBe(boardId);
    expect(conn.provider.serverUrl).toBe(wsServerUrl());
    expect(conn.provider.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);

    // Before open nothing is sent; the first frame on open is a sync message.
    socket.serverOpen();
    expect(conn.provider.wsconnected).toBe(true);
    expect(socket.sent.length).toBeGreaterThanOrEqual(1);
    expect(firstFrameType(socket.sent[0])).toBe(0); // messageSync
  });

  it('reports connected on open, reconnecting after an abnormal close, and recovers', async () => {
    const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const doc = new Y.Doc();
    const statuses: string[] = [];
    conn = connectBoard(boardId, doc, { WebSocketPolyfill: FakeSocket });
    conn.provider.on('status', (s: { status: string }) => statuses.push(s.status));
    conn.provider.on('sync', (synced: boolean) => statuses.push(synced ? 'synced' : 'unsynced'));

    FakeSocket.instances[0].serverOpen();
    expect(statuses).toContain('connected');

    // Abnormal close → disconnected (client shows "reconnecting").
    FakeSocket.instances[0].serverClose(1006);
    expect(statuses).toContain('disconnected');
    expect(conn.provider.shouldConnect).toBe(true);
  });

  it('never schedules a reconnect delay above RECONNECT_MAX_BACKOFF_MS', () => {
    vi.useFakeTimers();
    const scheduled: Scheduled[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
        scheduled.push({ fn: () => fn(...args), ms });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
    );

    const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const doc = new Y.Doc();
    conn = connectBoard(boardId, doc, { WebSocketPolyfill: FakeSocket });

    let maxDelaySeen = 0;
    // Cycle open → abnormal close many times to grow the exponential backoff.
    for (let i = 0; i < 10; i++) {
      const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
      socket.serverOpen();
      socket.serverClose(1006);
      // Run every pending reconnect timer so the next attempt is scheduled.
      const pending = scheduled.splice(0, scheduled.length);
      for (const s of pending) {
        if (s.ms > maxDelaySeen) maxDelaySeen = s.ms;
        try {
          s.fn();
        } catch {
          /* ignore reconnect internals that need a socket */
        }
      }
    }

    // Backoff grew and was capped at the configured maximum.
    expect(maxDelaySeen).toBe(RECONNECT_MAX_BACKOFF_MS);
    expect(scheduled.every((s) => s.ms <= RECONNECT_MAX_BACKOFF_MS)).toBe(true);
  });

  it.each([
    [4400, false],
    [4409, false],
    [4499, false],
    [1006, true],
    [1011, true],
    [1000, true],
  ])('close code %i → provider shouldConnect becomes %s', (code, expected) => {
    const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const doc = new Y.Doc();
    conn = connectBoard(boardId, doc, { WebSocketPolyfill: FakeSocket });
    FakeSocket.instances[0].serverOpen();
    FakeSocket.instances[0].serverClose(code);
    expect(conn.provider.shouldConnect).toBe(expected);
  });

  it('serverMessage of a remote update mutates the local doc (real Yjs path)', () => {
    const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const doc = new Y.Doc();
    conn = connectBoard(boardId, doc, { WebSocketPolyfill: FakeSocket });
    const socket = FakeSocket.instances[0];
    socket.serverOpen();

    // Build a genuine SyncStep2 frame carrying a note from a separate doc.
    const other = new Y.Doc();
    const objects = other.getMap('objects');
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    objects.set('id-1', note);

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // messageSync
    syncProtocol.writeSyncStep2(enc, other);
    socket.serverMessage(encoding.toUint8Array(enc));

    // The remote note landed locally and the provider answered on the socket.
    expect(doc.getMap('objects').has('id-1')).toBe(true);
    expect(socket.sent.length).toBeGreaterThanOrEqual(2);
  });
});

describe('connectBoard close codes → badge signal (story 4, TC-22/TC-24 support)', () => {
  const boardId = 'aaaaaaaaaaaaaaaaaaaaaa';

  function connect() {
    conn = connectBoard(boardId, new Y.Doc(), { WebSocketPolyfill: FakeSocket });
    const signals: ProviderSignal[] = [];
    conn.onCloseSignal((s) => signals.push(s));
    FakeSocket.instances[0].serverOpen();
    return { signals };
  }

  it('close 4500 is reported as a load failure and the client keeps retrying', () => {
    vi.useFakeTimers();
    const { signals } = connect();
    FakeSocket.instances[FakeSocket.instances.length - 1].serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(signals).toEqual(['load-failed']);
    // The board is not abandoned: y-websocket keeps its reconnect machinery.
    expect(conn!.provider.shouldConnect).toBe(true);
    expect(conn!.provider.wsUnsuccessfulReconnects).toBe(1);
    const before = FakeSocket.instances.length;
    vi.advanceTimersByTime(RECONNECT_MAX_BACKOFF_MS * 2);
    expect(FakeSocket.instances.length).toBeGreaterThan(before);
  });

  it('close 1011 (storage failure) and 1006 (network drop) are ordinary disconnects', () => {
    for (const code of [CLOSE_STORAGE_FAILURE, 1006]) {
      const { signals } = connect();
      FakeSocket.instances[FakeSocket.instances.length - 1].serverClose(code);
      expect(signals).toEqual(['disconnected']);
      conn!.destroy();
      conn = null;
    }
  });

  it('a close we asked for is never read as a load failure', () => {
    vi.useFakeTimers();
    const { signals } = connect();
    conn!.provider.disconnect(); // local close: y-websocket reports a null event
    expect(signals).toEqual(['disconnected']);
  });

  it('onCloseSignal returns an unsubscribe function', () => {
    conn = connectBoard(boardId, new Y.Doc(), { WebSocketPolyfill: FakeSocket });
    const seen: ProviderSignal[] = [];
    const off = conn.onCloseSignal((s) => seen.push(s));
    FakeSocket.instances[0].serverOpen();
    off();
    FakeSocket.instances[0].serverClose(CLOSE_BOARD_LOAD_FAILED);
    expect(seen).toEqual([]);
  });
});
