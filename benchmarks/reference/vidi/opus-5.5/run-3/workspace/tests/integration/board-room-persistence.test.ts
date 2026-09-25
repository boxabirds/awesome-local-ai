// persist.room: a real BoardRoom with real sockets and real SQLite storage. Restarts are real: the object is
// aborted (`state.abort()`), and the next request constructs a new instance over the same storage.
import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { BoardRoom } from '../../src/worker/board-room';
import { BoardStore, type BoardStorage } from '../../src/worker/board-store';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  encodeSync,
} from '../../src/shared/protocol';
import { TestClient, converged, quiet, waitFor } from './ws-client';
import { recordBoard, retroBoard } from '../fixtures/boards';

/** The room's private members the tests reach into (as story 3's tests read `doc`). */
interface RoomInternals {
  doc: Y.Doc | null;
  store: BoardStore;
  loadFailedAt: number;
  load(): void;
}
const internals = (room: BoardRoom) => room as unknown as RoomInternals;

const open: TestClient[] = [];
async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  open.push(c);
  return c;
}
async function attach(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.open(boardId, doc);
  open.push(c);
  return c;
}
afterEach(() => {
  open.splice(0).forEach((c) => c.close());
});

const stub = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

function inRoom<T>(boardId: string, fn: (room: BoardRoom, state: DurableObjectState) => T | Promise<T>): Promise<T> {
  return runInDurableObject(stub(boardId), fn);
}

/** Restarts the board's object: memory is gone, storage stays. */
async function restart(boardId: string): Promise<void> {
  await inRoom(boardId, (_room, state) => state.abort('test restart')).catch(() => undefined);
}

function storedRowCount(boardId: string): Promise<number> {
  return inRoom(boardId, (_room, state) => Number(state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').one().n));
}

/** The board as a fresh doc loaded straight from storage (independent of the room's memory). */
async function storedNotes(boardId: string): Promise<readonly StickySnapshot[]> {
  const update = await inRoom(boardId, (_room, state) => {
    const doc = new Y.Doc();
    const result = new BoardStore(state.storage).load(doc);
    if (!result.ok) throw new Error(result.error);
    return Y.encodeStateAsUpdate(doc);
  });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return snapshot(doc);
}

/** Waits until the board loaded from storage equals `expected`. */
async function storedMatches(boardId: string, expected: readonly StickySnapshot[]): Promise<void> {
  const want = JSON.stringify(expected);
  const start = Date.now();
  while (JSON.stringify(await storedNotes(boardId)) !== want) {
    if (Date.now() - start > 5000) throw new Error('timed out waiting for storage');
    await quiet();
  }
}

/** A board with the 25-note retro board made by one client and compacted into a snapshot; all clients gone. */
async function snapshottedRetroBoard() {
  const boardId = newBoardId();
  const a = await join(boardId);
  retroBoard(a.doc);
  const expected = snapshot(a.doc);
  await storedMatches(boardId, expected);
  await inRoom(boardId, (room) => {
    const r = internals(room);
    expect(r.store.compact(r.doc!)).toBe(true);
  });
  a.close();
  return { boardId, expected };
}

async function corruptChunk0(boardId: string): Promise<Uint8Array> {
  return inRoom(boardId, (_room, state) => {
    const original = new Uint8Array(state.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice(0, original.length - 10));
    return original;
  });
}

/** A SyncStep2 frame carrying a whole doc built by `build`. */
function syncStep2With(build: (doc: Y.Doc) => void): Uint8Array {
  const { doc } = recordBoard(build);
  return encodeSync((e) => syncProtocol.writeSyncStep2(e, doc));
}

describe('persist.room', () => {
  it('TC-12 a change is stored by the time another client sees it, and survives everyone leaving', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const rowsBefore = await storedRowCount(boardId);
    createSticky(a.doc, { x: 10, y: 20 }, 'green');
    await waitFor(() => b.notes().length === 1, 'note on B');
    // Checked the moment B has it: the row was written before the broadcast.
    expect(await storedRowCount(boardId)).toBe(rowsBefore + 1);
    a.close();
    b.close();
    expect(await storedNotes(boardId)).toEqual(a.notes());
    await restart(boardId);
    expect(await storedNotes(boardId)).toEqual(a.notes());
  });

  it('TC-13 after everyone leaves and the object restarts, a new client gets the whole board', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    retroBoard(a.doc);
    const expected = await converged([a, b]);
    expect(expected).toHaveLength(25);
    a.close();
    b.close();
    await quiet();
    await restart(boardId);
    await inRoom(boardId, (room) => expect(internals(room).doc).not.toBeNull()); // a new instance, loaded
    const c = await join(boardId);
    expect(c.notes()).toEqual(expected);
  });

  it('TC-14 a failed save is not relayed; sockets close 1011 and the change is saved when its author reconnects', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    await inRoom(boardId, (room) => {
      const store = internals(room).store;
      const append = store.append.bind(store);
      let failures = 1;
      store.append = (u: Uint8Array) => {
        if (failures-- > 0) throw new Error('injected storage failure');
        append(u);
      };
    });
    const rowsBefore = await storedRowCount(boardId);
    createSticky(a.doc, { x: 0, y: 0 }, 'pink');
    expect(await a.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);
    expect(await b.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.notes()).toEqual([]);
    expect(await storedRowCount(boardId)).toBe(rowsBefore);
    await inRoom(boardId, (room) => expect(internals(room).doc).toBeNull());

    // B comes back first, then A, which still holds the change and re-sends it in its SyncStep2.
    b.detach();
    a.detach();
    const b2 = await join(boardId, b.doc);
    expect(b2.notes()).toEqual([]);
    const a2 = await join(boardId, a.doc);
    const notes = await converged([a2, b2]);
    expect(notes).toHaveLength(1);
    expect(await storedNotes(boardId)).toEqual(notes);
  });

  it('TC-15 a board whose snapshot is unreadable is closed with 4500 and stores nothing sent to it', async () => {
    const { boardId } = await snapshottedRetroBoard();
    await corruptChunk0(boardId);
    await restart(boardId);
    const rowsBefore = await storedRowCount(boardId);

    const c = await attach(boardId);
    c.send(syncStep2With((d) => createSticky(d, { x: 5, y: 5 })));
    expect(await c.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.count('sync-step1') + c.count('sync-step2') + c.count('update')).toBe(0); // no empty board served
    expect(await storedRowCount(boardId)).toBe(rowsBefore);
    await inRoom(boardId, (room) => expect(internals(room).doc).toBeNull());
  });

  it('TC-16 a failed load is retried only after LOAD_RETRY_MIN_INTERVAL_MS, and then the board syncs', async () => {
    const { boardId, expected } = await snapshottedRetroBoard();
    const original = await corruptChunk0(boardId);
    await restart(boardId);
    const first = await attach(boardId);
    expect(await first.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);

    let loads = 0;
    await inRoom(boardId, (room) => {
      const store = internals(room).store;
      const load = store.load.bind(store);
      store.load = (doc: Y.Doc) => {
        loads++;
        return load(doc);
      };
    });
    await inRoom(boardId, (_room, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
    });

    // Before the interval: closed again without even trying to load (storage is already repaired).
    const early = await attach(boardId);
    expect(await early.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loads).toBe(0);

    // Exactly the interval later (the failure time is moved back instead of waiting): the load is retried.
    await inRoom(boardId, (room) => {
      internals(room).loadFailedAt -= LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const late = await join(boardId);
    expect(loads).toBe(1);
    expect(late.notes()).toEqual(expected);
    expect(late.closeCode).toBeNull();
  });

  it('TC-17 a garbage update closes the sender with 1003 and is not stored', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await storedMatches(boardId, a.notes());
    const rowsBefore = await storedRowCount(boardId);
    a.send(encodeSync((e) => syncProtocol.writeUpdate(e, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f]))));
    expect(await a.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await storedRowCount(boardId)).toBe(rowsBefore);
  });

  it('TC-18 a reconstructed room relays to sockets accepted by the previous instance (hibernation)', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    retroBoard(a.doc);
    await converged([a, b]);

    const added = await inRoom(boardId, async (_room, state) => {
      // A new instance over the same state, as after the runtime evicted a hibernating object.
      const fresh = new BoardRoom(state, env);
      await state.blockConcurrencyWhile(async () => undefined);
      const doc = internals(fresh).doc!;
      expect(snapshot(doc)).toHaveLength(25);
      const sockets = state.getWebSockets();
      expect(sockets).toHaveLength(2);
      const clone = new Y.Doc();
      Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
      const { updates } = recordBoard((d) => createSticky(d, { x: 777, y: 777 }, 'violet'), clone);
      fresh.webSocketMessage(sockets[0], encodeSync((e) => syncProtocol.writeUpdate(e, Y.mergeUpdates(updates))).slice().buffer);
      return snapshot(clone).find((n) => n.x === 777 - 100)!.id;
    });
    // The other socket gets the note from the new instance; the sender gets no echo.
    await waitFor(() => [a, b].some((c) => c.notes().some((n) => n.id === added)), 'relayed note');
    await quiet();
    expect([a, b].filter((c) => c.notes().some((n) => n.id === added))).toHaveLength(1);
    expect((await storedNotes(boardId)).some((n) => n.id === added)).toBe(true);
  });

  it('TC-26 an SQL error while loading closes clients with 4500', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await storedMatches(boardId, a.notes());
    a.close();
    await inRoom(boardId, (room, state) => {
      const failing: BoardStorage = {
        transactionSync: (fn) => state.storage.transactionSync(fn),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.startsWith('SELECT')) throw new Error('injected SQL read failure');
            return state.storage.sql.exec(query, ...bindings);
          },
        },
      };
      const r = internals(room);
      r.store = new BoardStore(failing);
      r.load(); // what the constructor does on wake
      expect(r.doc).toBeNull();
    });
    const c = await attach(boardId);
    expect(await c.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.count('sync-step1')).toBe(0);
  });
});
