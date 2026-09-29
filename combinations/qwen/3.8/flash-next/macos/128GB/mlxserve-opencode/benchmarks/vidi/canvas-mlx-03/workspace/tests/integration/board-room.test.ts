/// <reference types="@cloudflare/vitest-pool-workers" />
// Integration tests for the BoardRoom Durable Object: relay, initial
// synchronisation, CRDT convergence, capacity, malformed handling, awareness
// relay and restart catch-up. All run inside workerd with real Y.Docs speaking
// real y-protocols over real WebSockets.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id.ts';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.ts';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
} from '../../src/shared/board-model.ts';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol.ts';
import {
  RoomClient,
  connectClients,
  waitFor,
  flush,
  snapshotsEqual,
} from './helpers/ws-client.ts';
import { applyRandomOps } from './helpers/random-ops.ts';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Build a raw sync frame whose inner message is `inner(enc)`.
function syncFrame(inner: (enc: encoding.Encoder) => void): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  inner(enc);
  return encoding.toUint8Array(enc).buffer;
}

describe('BoardRoom sync (TC-07..TC-12, TC-14..TC-18, TC-31)', () => {
  it('TC-07 one client creates a sticky and every other client sees it', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    a.clearLog();
    b.clearLog();

    createSticky(a.doc, { x: 20, y: 30 });
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'b converges');

    expect(b.snapshot()).toHaveLength(1);
    // B received exactly one update frame.
    expect(b.syncMessageCount()).toBe(1);
    a.close();
    b.close();
  });

  it.each([
    ['move', (id: string, c: RoomClient) => moveObject(c.doc, id, 400, -220)],
    ['recolour', (id: string, c: RoomClient) => setStickyColor(c.doc, id, 'pink')],
    [
      'text insert',
      (id: string, c: RoomClient) => getStickyText(c.doc, id)?.insert(0, 'hello '),
    ],
    ['delete', (id: string, c: RoomClient) => deleteObject(c.doc, id)],
  ])('TC-08 %s propagates and the writer receives no echo', async (_name, op) => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    // Seed a note with text so move/recolour/text/delete all have a target.
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'world');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'seed synced');

    a.clearLog();
    b.clearLog();
    (op as (id: string, c: RoomClient) => void)(id, a);

    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'converged');
    expect(b.syncMessageCount()).toBeGreaterThanOrEqual(1);
    // No echo back to the writer.
    expect(a.log).toHaveLength(0);
    a.close();
    b.close();
  });

  it('TC-09 concurrent text edits merge to the same final string', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'green');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'seed synced');

    // Concurrent inserts, neither having seen the other yet (same tick).
    const ta = getStickyText(a.doc, id)!;
    const tb = getStickyText(b.doc, id)!;
    ta.insert(0, 'red ');
    tb.insert(tb.length, ' blue');

    await waitFor(
      () => a.snapshot()[0]?.text === 'red green blue' && b.snapshot()[0]?.text === 'red green blue',
      'both converge to "red green blue"',
    );
    expect(a.snapshot()[0].text).toBe('red green blue');
    expect(b.snapshot()[0].text).toBe('red green blue');
    a.close();
    b.close();
  });

  it('TC-10 concurrent position writes resolve to one identical position', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'seed synced');

    // Concurrent conflicting position writes on the same key (same tick).
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await waitFor(() => a.snapshot()[0]?.x === b.snapshot()[0]?.x, 'positions agree');
    expect(a.snapshot()[0].x).toBe(b.snapshot()[0].x);
    expect([100, 300]).toContain(a.snapshot()[0].x);
    a.close();
    b.close();
  });

  it('TC-11 delete while a remote inserts into the text converges to absent', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'original');
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'seed synced');

    // Concurrent: A deletes the note; B inserts into the (about-to-die) Y.Text.
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)?.insert(0, 'ghost');

    await waitFor(() => a.snapshot().length === 0 && b.snapshot().length === 0, 'note gone on both');
    // The ghost insert is discarded everywhere.
    const ghostPresent = [a, b].some((c) => c.snapshot().some((s) => s.text.includes('ghost')));
    expect(ghostPresent).toBe(false);
    // No crash: both clients still connected, room functional.
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
    a.close();
    b.close();
  });

  it('TC-12 MAX clients × 200 random operations converge to identical state', async () => {
    const boardId = newBoardId();
    const seed = 0xc0ffee;
    const clients = await connectClients(boardId, MAX_CONCURRENT_EDITORS);
    // Each client contributes a distinct stream of operations.
    clients.forEach((c, i) => applyRandomOps(c.doc, seed + i, 200));

    await waitFor(
      () => clients.every((c) => snapshotsEqual(clients[0].snapshot(), c.snapshot())),
      'all clients identical',
      15000,
    );
    // Sanity: work actually happened.
    expect(clients[0].snapshot().length).toBeGreaterThan(0);
    clients.forEach((c) => c.close());
  });

  it('TC-14 a client that joins late gets the 20 notes created before it arrived', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: i });
    await waitFor(() => a.snapshot().length === 10, 'a seeded 10');
    const secondIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      secondIds.push(createSticky(b.doc, { x: 100 + i, y: 100 + i }));
      await flush(2);
    }
    await waitFor(() => snapshotsEqual(a.snapshot(), b.snapshot()), 'a,b synced at 20');
    expect(a.snapshot()).toHaveLength(20);

    const c = await RoomClient.connect(boardId);
    await waitFor(() => c.synced, 'c synced');
    await waitFor(() => snapshotsEqual(a.snapshot(), c.snapshot()), 'late joiner matches');
    expect(c.snapshot()).toHaveLength(20);
    a.close();
    b.close();
    c.close();
  });

  describe.each([
    ['text frame', 'text'],
    ['truncated bytes', 'truncated'],
    ['unknown message type', 'unknown'],
    ['invalid Yjs update', 'invalid-update'],
  ])('TC-15 malformed traffic: %s', (_label, kind) => {
    it('closes the offending socket with 1003 without corrupting the room', async () => {
      const boardId = newBoardId();
      const [a, b] = await connectClients(boardId, 2);
      b.clearLog();

      if (kind === 'text') {
        a.sendText('this is a text frame, not y-websocket binary');
      } else if (kind === 'truncated') {
        // A sync/awareness header with a truncated varuint continuation byte.
        a.sendRaw(new Uint8Array([MESSAGE_SYNC, 0x80]).buffer);
      } else if (kind === 'unknown') {
        // Outer type 9 (not sync/awareness/query) with a payload.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 9);
        encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
        a.sendRaw(encoding.toUint8Array(enc).buffer);
      } else {
        // A well-formed sync frame carrying an unparseable Yjs update.
        a.sendRaw(
          syncFrame((enc) =>
            syncProtocol.writeUpdate(enc, new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0x00])),
          ),
        );
      }

      await waitFor(() => a.closed && a.closeCode === CLOSE_UNSUPPORTED_DATA, 'offender closed 1003');
      expect(b.closed).toBe(false);

      // The room is uncorrupted and still relays to remaining clients.
      const c = await RoomClient.connect(boardId);
      await waitFor(() => c.synced, 'c synced');
      createSticky(c.doc, { x: 7, y: 7 });
      await waitFor(() => snapshotsEqual(c.snapshot(), b.snapshot()), 'b still receives');
      // The malformed bytes left no note behind: exactly the one marker note.
      expect(b.snapshot().length).toBe(1);
      a.close();
      b.close();
      c.close();
    });
  });

  it('TC-16 awareness bytes sent by one client are relayed unchanged to the others', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    a.clearLog();
    b.clearLog();

    // An opaque payload (awareness updates are not interpreted by the room).
    const payload = new Uint8Array([0x01, 0x40, 0x7f, 0x00, 0x7a]);
    a.sendAwareness(payload);

    await waitFor(() => a.log.length === 1 && b.log.length === 1, 'both got the frame');
    const frame = new Uint8Array(a.log[0]);
    expect(Array.from(b.log[0] ? new Uint8Array(b.log[0]) : [])).toEqual(Array.from(frame));
    a.close();
    b.close();
  });

  it('TC-18 a restarted room is repopulated by the first reconnecting client', async () => {
    // Simulate a restart: a fresh room instance (new object id) with a client
    // that already held the board state (prepopulated before reconnect).
    const boardId = newBoardId();
    const [a] = await connectClients(boardId, 1);
    const id = createSticky(a.doc, { x: 1, y: 2 });
    getStickyText(a.doc, id)?.insert(0, 'survives');
    await flush();
    const held = a.snapshot().slice();
    expect(held).toHaveLength(1);
    a.close();

    // "Room restart": a brand-new room instance for a fresh object id.
    const freshBoard = newBoardId();
    const aRe = await RoomClient.connect(freshBoard, {
      prepopulate: (doc) => {
        // A holds the board across the restart; rebuild its state locally.
        const nid = createSticky(doc, { x: 1, y: 2 });
        getStickyText(doc, nid)?.insert(0, 'survives');
      },
    });
    await waitFor(() => aRe.synced, 'reconnected A synced');
    // The room doc is now A's content: a second client converges to it.
    const bRe = await RoomClient.connect(freshBoard);
    await waitFor(() => bRe.synced, 'B synced');
    await waitFor(() => snapshotsEqual(aRe.snapshot(), bRe.snapshot()), 'both populated');
    expect(bRe.snapshot()).toHaveLength(1);
    expect(bRe.snapshot()[0].text).toBe('survives');

    aRe.close();
    bRe.close();
  });

  it('TC-31 an abrupt socket close does not stop the room relaying to others', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    b.clearLog();

    // B's socket goes away abruptly, then A writes immediately (send may throw
    // in the room if the close event has not landed yet).
    b.close();
    createSticky(a.doc, { x: 0, y: 0 });
    await flush(40);

    // No crash: a later client still syncs and receives subsequent updates.
    const c = await RoomClient.connect(boardId);
    await waitFor(() => c.synced, 'c synced');
    await waitFor(() => c.snapshot().length === 1, 'c has the earlier note');
    const later = createSticky(a.doc, { x: 5, y: 5 });
    await waitFor(() => c.snapshot().some((s) => s.id === later), 'c receives updates after fault');

    a.close();
    c.close();
  });
});
