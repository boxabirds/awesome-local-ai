/**
 * Persistent, hibernating BoardRoom (persist.room, TC-12 to TC-18, TC-26) with the real
 * Durable Object, real sockets and real SQLite storage. Failures are injected by wrapping
 * the room's BoardStore (or the storage it reads); damage is real bytes in real tables.
 */
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import { RETRO_NOTES, buildRetroBoard, truncatedUpdate } from '../fixtures/boards';
import { TestClient, createdBoardId, sameState, sleep, waitConverged, waitUntil } from './helpers/ws-client';

const QUIET_MS = 100;
const GARBAGE_UPDATE = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

let open: TestClient[] = [];

afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function room(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

async function connect(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  open.push(c);
  return c;
}

async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await connect(boardId, doc);
  await c.waitForSync();
  return c;
}

async function closeAndWait(clients: TestClient[]): Promise<void> {
  clients.forEach((c) => c.close());
  await sleep(QUIET_MS);
}

function updateRows(storage: DurableObjectStorage): number {
  return storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates').one().n;
}

/** The board as a fresh doc loaded from the room's storage. */
async function storedBoard(boardId: string): Promise<Y.Doc> {
  return runInDurableObject(room(boardId), (_i, state) => {
    const doc = new Y.Doc();
    const result = new BoardStore(state.storage).load(doc);
    if (!result.ok) throw new Error(`stored board unreadable: ${result.reason}`);
    return doc;
  });
}

async function rowCount(boardId: string): Promise<number> {
  return runInDurableObject(room(boardId), (_i, state) => updateRows(state.storage));
}

/** A 25-note board saved as a snapshot, with the room's instance evicted afterwards. */
async function snapshottedBoard(): Promise<{ boardId: string; original: Y.Doc }> {
  const boardId = await createdBoardId();
  const a = await join(boardId);
  buildRetroBoard(a.doc);
  const probe = await join(boardId);
  await waitConverged([a, probe]);
  await closeAndWait([a, probe]);
  await runInDurableObject(room(boardId), (_i, state) => {
    const doc = new Y.Doc();
    const store = new BoardStore(state.storage);
    store.load(doc);
    expect(store.compact(doc)).toBe(true);
  });
  return { boardId, original: a.doc };
}

async function corruptSnapshotChunk(boardId: string): Promise<Uint8Array> {
  return runInDurableObject(room(boardId), (_i, state) => {
    const chunk = new Uint8Array(state.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncatedUpdate(chunk));
    return chunk;
  });
}

function syncStep2Frame(doc: Y.Doc): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(e, doc);
  return encoding.toUint8Array(e);
}

describe('Persistent BoardRoom (persist.room)', () => {
  it('TC-12 a change another client has received is already stored', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const id = createSticky(a.doc, { x: 10, y: 20 }, 'orange');
    await waitUntil(() => b.snapshot().some((n) => n.id === id), 'B to receive the note');
    // Read storage the moment B has observed the change.
    const stored = await runInDurableObject(room(boardId), (_i, state) =>
      state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates').one().n,
    );
    expect(stored).toBeGreaterThanOrEqual(1);
    await closeAndWait([a, b]);
    const fresh = await storedBoard(boardId);
    expect(snapshot(fresh).map((n) => n.id)).toContain(id);
    expect(snapshot(fresh).find((n) => n.id === id)).toEqual(snapshot(a.doc).find((n) => n.id === id));
  });

  it('TC-13 after everyone leaves, a new room instance serves the identical board', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    buildRetroBoard(a.doc);
    const b = await join(boardId);
    await waitConverged([a, b]);
    await closeAndWait([a, b]);
    await evictDurableObject(room(boardId));

    const c = await join(boardId);
    expect(snapshot(c.doc)).toHaveLength(RETRO_NOTES);
    expect(snapshot(c.doc)).toEqual(snapshot(a.doc));
    expect(sameState(c.doc, a.doc)).toBe(true);
  });

  it('TC-25 opening a never-edited board stores nothing', async () => {
    const boardId = await createdBoardId();
    const a = await connect(boardId);
    await waitUntil(() => a.synced, 'sync');
    await sleep(QUIET_MS);
    expect(await rowCount(boardId)).toBe(0);
    expect(snapshot(a.doc)).toEqual([]);
  });

  it('TC-14 a failed save is not broadcast, closes everyone with 1011, and is saved on reconnection', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const kept = createSticky(a.doc, { x: 0, y: 0 });
    await waitUntil(() => b.snapshot().length === 1, 'first note');
    await runInDurableObject(room(boardId), (instance) => {
      const store = instance.store;
      const append = store.append.bind(store);
      let failures = 1;
      store.append = (u: Uint8Array) => {
        if (failures-- > 0) throw new Error('injected: disk full');
        append(u);
      };
    });
    const rowsBefore = await rowCount(boardId);

    const lost = createSticky(a.doc, { x: 300, y: 0 }, 'pink');

    await waitUntil(() => a.closeCode !== null && b.closeCode !== null, 'both sockets closed');
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot().map((n) => n.id)).toEqual([kept]);
    expect(await rowCount(boardId)).toBe(rowsBefore);

    // A still holds the change; reconnecting re-sends it through the sync handshake.
    a.close();
    b.close();
    const a2 = await join(boardId, a.doc);
    const b2 = await join(boardId, b.doc);
    await waitConverged([a2, b2]);
    expect(b2.snapshot().map((n) => n.id).sort()).toEqual([kept, lost].sort());
    const fresh = await storedBoard(boardId);
    expect(snapshot(fresh).map((n) => n.id).sort()).toEqual([kept, lost].sort());
  });

  it('TC-15 a board whose snapshot is damaged closes clients with 4500 and stores nothing', async () => {
    const { boardId } = await snapshottedBoard();
    await corruptSnapshotChunk(boardId);
    await evictDurableObject(room(boardId));
    const rowsBefore = await rowCount(boardId);

    const writer = new Y.Doc();
    createSticky(writer, { x: 0, y: 0 });
    const c = await connect(boardId, writer);
    c.sendRaw(syncStep2Frame(writer));
    await waitUntil(() => c.closeCode !== null, 'close');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.synced).toBe(false);
    await sleep(QUIET_MS);
    expect(await rowCount(boardId)).toBe(rowsBefore);
    const state = await runInDurableObject(room(boardId), (instance) => instance.state);
    expect(state).toBe('load-failed');
  });

  it('TC-16 a load-failed room retries only after LOAD_RETRY_MIN_INTERVAL_MS, then serves the repaired board', async () => {
    const { boardId, original } = await snapshottedBoard();
    const chunk0 = await corruptSnapshotChunk(boardId);
    await evictDurableObject(room(boardId));
    const first = await connect(boardId);
    await waitUntil(() => first.closeCode !== null, 'first close');
    expect(first.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Count load attempts and repair the storage.
    await runInDurableObject(room(boardId), (instance, state) => {
      const store = instance.store;
      const load = store.load.bind(store);
      (instance as unknown as { loads: number }).loads = 0;
      store.load = (doc: Y.Doc) => {
        (instance as unknown as { loads: number }).loads += 1;
        return load(doc);
      };
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', chunk0);
    });

    // Before the interval: refused without a reload attempt, even though storage is fine now.
    const early = await connect(boardId);
    await waitUntil(() => early.closeCode !== null, 'early close');
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await runInDurableObject(room(boardId), (i) => (i as unknown as { loads: number }).loads)).toBe(0);

    // At the interval: reloads and syncs.
    await runInDurableObject(room(boardId), (instance) => {
      const failedAt = instance.lifecycle.kind === 'load-failed' ? instance.lifecycle.failedAt : 0;
      instance.now = () => failedAt + LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const later = await join(boardId);
    expect(later.closeCode).toBeNull();
    expect(await runInDurableObject(room(boardId), (i) => (i as unknown as { loads: number }).loads)).toBe(1);
    expect(snapshot(later.doc)).toEqual(snapshot(original));
  });

  it('TC-17 a garbage update closes the sender with 1003 and is not stored', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await sleep(QUIET_MS);
    const before = await rowCount(boardId);
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    syncProtocol.writeUpdate(e, GARBAGE_UPDATE);
    a.sendRaw(encoding.toUint8Array(e));
    await waitUntil(() => a.closeCode !== null, 'close');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await rowCount(boardId)).toBe(before);
  });

  it('TC-18 sockets accepted before the object was evicted still get broadcasts after it wakes', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    buildRetroBoard(a.doc);
    await waitConverged([a, b]);

    await evictDurableObject(room(boardId)); // sockets hibernate, instance torn down

    const id = createSticky(a.doc, { x: -900, y: -900 }, 'green'); // wakes a new instance
    await waitUntil(() => b.snapshot().some((n) => n.id === id), 'broadcast after wake');
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();
    const sockets = await runInDurableObject(room(boardId), (_i, state) => state.getWebSockets().length);
    expect(sockets).toBe(2);
    await waitConverged([a, b]);
    expect(snapshot(b.doc)).toHaveLength(RETRO_NOTES + 1);
  });

  it('TC-26 a SQL error while loading closes clients with 4500', async () => {
    const boardId = await createdBoardId();
    const a = await join(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await closeAndWait([a]);

    const reason = await runInDurableObject(room(boardId), (instance, state) => {
      const real = state.storage;
      const failing = {
        transactionSync: real.transactionSync.bind(real),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (query.trimStart().startsWith('SELECT')) throw new Error('injected: SQLITE_IOERR');
            return real.sql.exec(query, ...bindings);
          },
        },
      } as unknown as DurableObjectStorage;
      instance.store = new BoardStore(failing);
      const result = instance.load();
      return result.ok ? 'ok' : result.reason;
    });
    expect(reason).toBe('sql-error');

    const c = await connect(boardId);
    await waitUntil(() => c.closeCode !== null, 'close');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});
