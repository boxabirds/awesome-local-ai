// persist.room: a real BoardRoom with real sockets over its real SQLite storage.
import { SELF, env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  encodeUpdate,
} from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { corruptSnapshotChunk, repairSnapshotChunk } from '../../src/worker/test-hooks';
import { retroBoard } from '../fixtures/boards';
import { TestClient, roomUrl, waitFor, createBoardId } from './ws-client';

const open: TestClient[] = [];
async function connect(boardId: string, doc?: Y.Doc) {
  const client = await TestClient.connect(boardId, doc);
  open.push(client);
  return client;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

const stubOf = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

function inRoom<R>(boardId: string, fn: (room: BoardRoom, state: DurableObjectState) => R) {
  return runInDurableObject(stubOf(boardId), fn);
}

/** Row counts of the board's storage. */
function counts(boardId: string) {
  return inRoom(boardId, (_room, state) => {
    const n = (t: string) => state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`).one().n;
    return { updates: n('updates'), chunks: n('snapshot_chunks'), quarantined: n('quarantined_updates') };
  });
}

/** The board as a fresh doc loaded from storage (what a woken room would see). */
function stored(boardId: string) {
  return inRoom(boardId, (_room, state) => {
    const doc = new Y.Doc();
    const result = new BoardStore(state.storage).load(doc);
    return { result, notes: snapshot(doc) };
  });
}

/** A socket without the sync handshake, recording its close code from the start. */
async function rawSocket(boardId: string) {
  const res = await SELF.fetch(roomUrl(boardId), { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket!;
  const socket = { ws, status: res.status, closeCode: null as number | null, frames: 0 };
  ws.addEventListener('close', (e) => {
    socket.closeCode = e.code;
  });
  ws.addEventListener('message', () => {
    socket.frames += 1;
  });
  ws.accept();
  return socket;
}

function trySend(ws: WebSocket, frame: Uint8Array) {
  try {
    ws.send(frame);
  } catch {
    // Closed already.
  }
}

/** Saves the 25-note retro board compacted (snapshot + empty log) and damages chunk 0. */
async function brokenBoard(boardId: string) {
  const board = retroBoard();
  await inRoom(boardId, (room, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    for (const u of board.updates) store.append(u);
    store.compactIfNeeded(board.doc, true);
    corruptSnapshotChunk(state.storage.sql);
    // As if the object had just woken over this storage.
    room['load']();
    expect(room['state'].name).toBe('load-failed');
  });
  return board;
}

/** Makes the last failed load look `ms` old. */
function ageLoadFailure(boardId: string, ms: number) {
  return inRoom(boardId, (room) => {
    const state = room['state'];
    if (state.name !== 'load-failed') throw new Error(`room is ${state.name}`);
    room['state'] = { ...state, failedAt: Date.now() - ms };
  });
}

function quietConsoleError() {
  const original = console.error;
  console.error = () => {};
  return () => (console.error = original);
}

describe('persist.room', () => {
  it('TC-12 a change another client has seen is already stored; storage alone restores it', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    expect((await counts(boardId)).updates).toBe(0);

    createSticky(a.doc, { x: 10, y: 20 }, 'green');
    await waitFor(() => b.snapshot().length === 1, 'B receives the note');
    // B has observed the change: its row must already exist.
    expect((await counts(boardId)).updates).toBeGreaterThanOrEqual(1);
    const { result, notes } = await stored(boardId);
    expect(result).toEqual({ ok: true, quarantined: 0 });
    expect(notes).toEqual(a.snapshot());

    a.close();
    b.close();
    expect((await stored(boardId)).notes).toEqual(b.snapshot());
  });

  it('TC-13 everyone leaves; a new room instance over the same storage serves the same board', async () => {
    const boardId = await createBoardId();
    const { doc: original, updates } = retroBoard();
    const a = await connect(boardId);
    for (const u of updates) Y.applyUpdate(a.doc, u);
    await a.roundTrip();
    a.close();
    await inRoom(boardId, (room) => {
      (room as unknown as { marker: number }).marker = 1;
    });
    await evictDurableObject(stubOf(boardId), { webSockets: 'close' });
    expect(await inRoom(boardId, (room) => (room as unknown as { marker?: number }).marker)).toBe(
      undefined,
    );

    const c = await connect(boardId);
    expect(c.snapshot()).toHaveLength(25);
    expect(c.snapshot()).toEqual(snapshot(original));
  });

  it('TC-14 a failed write is not relayed; sockets close 1011; the change is saved once A reconnects', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    await inRoom(boardId, (room) => {
      const store = room['store'];
      const append = store.append.bind(store);
      let failures = 1;
      store.append = (update: Uint8Array) => {
        if (failures-- > 0) throw new Error('injected write failure');
        append(update);
      };
    });
    const restore = quietConsoleError();
    try {
      createSticky(a.doc, { x: 0, y: 0 }, 'blue');
      await waitFor(() => a.closeCode !== null && b.closeCode !== null, 'both sockets closed');
    } finally {
      restore();
    }
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot()).toEqual([]);
    expect(b.updatesReceived).toBe(0);
    expect((await counts(boardId)).updates).toBe(0);
    // A still holds the change in its open page.
    expect(a.snapshot()).toHaveLength(1);

    const b2 = await connect(boardId, b.doc);
    const a2 = await connect(boardId, a.doc);
    await waitFor(() => b2.snapshot().length === 1, 'B receives the saved change');
    expect(b2.snapshot()).toEqual(a2.snapshot());
    expect((await stored(boardId)).notes).toEqual(a.snapshot());
  });

  it('TC-15 a board whose snapshot is unreadable closes clients with 4500 and stores nothing', async () => {
    const boardId = await createBoardId();
    await brokenBoard(boardId);
    const before = await counts(boardId);

    const socket = await rawSocket(boardId);
    expect(socket.status).toBe(101);
    // The client's SyncStep2 (its local changes) arrives while the room is load-failed.
    const local = new Y.Doc();
    createSticky(local, { x: 0, y: 0 });
    trySend(socket.ws, encodeUpdate(Y.encodeStateAsUpdate(local)));
    await waitFor(() => socket.closeCode !== null, 'close');
    expect(socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Never served an (empty) board.
    expect(socket.frames).toBe(0);
    expect(await counts(boardId)).toEqual(before);
    expect(before.chunks).toBeGreaterThan(0);
  });

  it('TC-16 retries loading only after LOAD_RETRY_MIN_INTERVAL_MS; a repaired board then syncs', async () => {
    const boardId = await createBoardId();
    const { doc: original } = await brokenBoard(boardId);
    let loads = 0;
    await inRoom(boardId, (room) => {
      const store = room['store'];
      const load = store.load.bind(store);
      store.load = (doc: Y.Doc) => {
        loads += 1;
        return load(doc);
      };
    });

    // Before the interval: closed 4500 without a reload attempt, even though storage is repaired.
    await inRoom(boardId, (_room, state) => expect(repairSnapshotChunk(state.storage.sql)).toBe(true));
    await ageLoadFailure(boardId, LOAD_RETRY_MIN_INTERVAL_MS - 1000);
    const early = await rawSocket(boardId);
    await waitFor(() => early.closeCode !== null, 'close');
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loads).toBe(0);

    // After the interval: the next connection reloads and syncs the whole board.
    await ageLoadFailure(boardId, LOAD_RETRY_MIN_INTERVAL_MS);
    const c = await connect(boardId);
    expect(loads).toBe(1);
    expect(c.snapshot()).toEqual(snapshot(original));
    createSticky(c.doc, { x: 0, y: 0 });
    await c.roundTrip();
    expect((await stored(boardId)).notes).toEqual(c.snapshot());
  });

  it('TC-16 a retry that fails again restarts the interval', async () => {
    const boardId = await createBoardId();
    await brokenBoard(boardId);
    await ageLoadFailure(boardId, LOAD_RETRY_MIN_INTERVAL_MS);
    const restore = quietConsoleError();
    try {
      const socket = await rawSocket(boardId);
      await waitFor(() => socket.closeCode !== null, 'close');
      expect(socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    } finally {
      restore();
    }
    const age = await inRoom(boardId, (room) => {
      const state = room['state'];
      return state.name === 'load-failed' ? Date.now() - state.failedAt : null;
    });
    expect(age).not.toBeNull();
    expect(age!).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);
  });

  it('TC-17 a garbage update closes the socket 1003 and is not stored', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await a.roundTrip();
    const before = await counts(boardId);

    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    encoding.writeVarUint(e, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(e, Uint8Array.from([1, 1, 0xff, 0xff, 0xff, 0x0f, 0, 9, 9, 9]));
    a.ws.send(encoding.toUint8Array(e));
    await waitFor(() => a.closeCode !== null, 'close');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await counts(boardId)).toEqual(before);
  });

  it('TC-18 after hibernation a rebuilt room relays to sockets accepted before it', async () => {
    const boardId = await createBoardId();
    const { updates } = retroBoard();
    const a = await connect(boardId);
    const b = await connect(boardId);
    for (const u of updates) Y.applyUpdate(a.doc, u);
    await waitFor(() => b.snapshot().length === 25, 'B has the board');
    await inRoom(boardId, (room) => {
      (room as unknown as { marker: number }).marker = 1;
    });

    await evictDurableObject(stubOf(boardId)); // sockets hibernate, stay open
    expect(a.isOpen && b.isOpen).toBe(true);
    const aBefore = a.updatesReceived;
    createSticky(a.doc, { x: 999, y: 999 }, 'violet');
    await waitFor(() => b.snapshot().length === 26, 'B receives the change after wake');
    expect(b.snapshot()).toEqual(a.snapshot());

    const room = await inRoom(boardId, (r, state) => ({
      marker: (r as unknown as { marker?: number }).marker,
      sockets: state.getWebSockets().length,
      notes: snapshot(r['doc']!).length,
    }));
    expect(room).toEqual({ marker: undefined, sockets: 2, notes: 26 });
    await a.roundTrip();
    expect(a.updatesReceived).toBe(aBefore); // no echo to the sender
  });

  it('TC-26 a SQL error while loading makes the room close new sockets with 4500', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await a.roundTrip();
    a.close();

    const restore = quietConsoleError();
    try {
      const result = await inRoom(boardId, (room, state) => {
        const failing = {
          sql: {
            exec(query: string, ...bindings: SqlStorageValue[]) {
              if (query.trimStart().startsWith('SELECT')) throw new Error('injected read failure');
              return state.storage.sql.exec(query, ...bindings);
            },
          },
          transactionSync: <T>(fn: () => T) => state.storage.transactionSync(fn),
        } as unknown as DurableObjectStorage;
        const store = new BoardStore(failing);
        const direct = store.load(new Y.Doc());
        room['store'] = store;
        room['load']();
        return { direct, state: room['state'].name };
      });
      expect(result.direct).toMatchObject({ ok: false, reason: 'sql-error' });
      expect(result.state).toBe('load-failed');
    } finally {
      restore();
    }
    const socket = await rawSocket(boardId);
    await waitFor(() => socket.closeCode !== null, 'close');
    expect(socket.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(socket.frames).toBe(0);
  });
});
