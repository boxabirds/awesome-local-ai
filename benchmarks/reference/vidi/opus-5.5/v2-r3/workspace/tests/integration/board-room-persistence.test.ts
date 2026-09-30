// Persistent, hibernating BoardRoom: real Durable Object, sockets and SQLite.
import { SELF, env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  encodeSyncFrame,
} from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { retroBoard } from '../fixtures/boards';
import { TestClient, waitFor, waitForConvergence } from './ws-client';

/** The room's private state, reached through runInDurableObject. */
interface RoomInternals {
  doc: Y.Doc | null;
  store: BoardStore | null;
  loadAttempts: number;
  state: string;
  createStore: (storage: DurableObjectStorage) => BoardStore;
  load(): void;
}

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

async function connect(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  clients.push(c);
  return c;
}

async function open(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.open(boardId, doc);
  clients.push(c);
  return c;
}

function stubFor(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function inRoom<R>(boardId: string, fn: (room: RoomInternals, state: DurableObjectState) => R | Promise<R>): Promise<R> {
  return runInDurableObject(stubFor(boardId), (instance, state) => fn(instance as unknown as RoomInternals, state));
}

function count(storage: DurableObjectStorage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

/** The board as a fresh store would load it from storage right now. */
function fromStorage(storage: DurableObjectStorage): Y.Doc {
  const doc = new Y.Doc();
  const store = new BoardStore(storage);
  store.migrate();
  const result = store.load(doc);
  if (!result.ok) throw new Error(`load failed: ${result.reason}`);
  return doc;
}

async function closeAndWait(...cs: TestClient[]): Promise<void> {
  for (const c of cs) c.close();
  await waitFor(() => cs.every((c) => c.closeCode !== null), 'sockets closed');
}

/** A board with the 25-note retro fixture, written by one client, compacted into a snapshot. */
async function snapshottedRetroBoard(): Promise<{ boardId: string; original: ReturnType<typeof snapshot>; chunk0: ArrayBuffer }> {
  const boardId = newBoardId();
  const a = await connect(boardId);
  retroBoard(a.doc);
  const observer = await connect(boardId);
  await waitForConvergence([a, observer]);
  const original = a.snapshot();
  const chunk0 = await inRoom(boardId, (room, state) => {
    expect(room.store!.compact(room.doc!)).toBe(true);
    return state.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data;
  });
  await closeAndWait(a, observer);
  return { boardId, original, chunk0: chunk0.slice(0) };
}

async function corruptSnapshot(boardId: string): Promise<void> {
  await inRoom(boardId, (_room, state) => {
    const chunk = state.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
    const damaged = new Uint8Array(chunk.data).slice(0, chunk.data.byteLength - 10);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged.buffer);
  });
  // Restart: the next connection constructs a fresh instance that loads from storage.
  await evictDurableObject(stubFor(boardId), { webSockets: 'close' });
}

function syncStep2Frame(doc: Y.Doc): Uint8Array {
  return encodeSyncFrame((e) => syncProtocol.writeSyncStep2(e, doc));
}

describe('BoardRoom durability (persist.room)', () => {
  it('TC-12: a change another client received is already stored; a fresh load contains it', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    const before = await inRoom(boardId, (_r, state) => count(state.storage, 'updates'));
    expect(before).toBe(0);
    const id = createSticky(a.doc, { x: 40, y: 60 }, 'green');
    await waitFor(() => b.snapshot().some((n) => n.id === id), 'B receives the note');
    const rows = await inRoom(boardId, (_r, state) => count(state.storage, 'updates'));
    expect(rows).toBe(1);
    await closeAndWait(a, b);
    const loaded = await inRoom(boardId, (_r, state) => snapshot(fromStorage(state.storage)));
    expect(loaded).toEqual(a.snapshot());
  });

  it('TC-13: after everyone leaves and the object restarts, a new client gets the whole board', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    retroBoard(a.doc);
    await waitForConvergence([a, b]);
    const original = a.snapshot();
    expect(original).toHaveLength(25);
    await closeAndWait(a, b);
    await evictDurableObject(stubFor(boardId), { webSockets: 'close' });
    const c = await connect(boardId);
    expect(c.snapshot()).toEqual(original);
    expect(await inRoom(boardId, (room) => room.loadAttempts)).toBe(1); // a fresh instance
  });

  it('TC-14: a failed save is not broadcast; sockets close 1011; reconnecting re-sends and delivers it', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    createSticky(a.doc, { x: 0, y: 0 }, 'blue');
    await waitForConvergence([a, b]);
    await inRoom(boardId, (room) => {
      const store = room.store!;
      const append = store.append.bind(store);
      let fail = true;
      store.append = (u) => {
        if (fail) {
          fail = false;
          throw new Error('injected append failure');
        }
        append(u);
      };
    });
    const id = createSticky(a.doc, { x: 300, y: 0 }, 'pink');
    await waitFor(() => a.closeCode !== null && b.closeCode !== null, 'both closed');
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot().some((n) => n.id === id)).toBe(false);
    expect(b.updateCount()).toBe(1); // only the first note
    const stored = await inRoom(boardId, (_r, state) => snapshot(fromStorage(state.storage)).map((n) => n.id));
    expect(stored).not.toContain(id);
    // B reconnects first, then A, which still holds the unsaved note.
    const b2 = await connect(boardId, b.doc);
    expect(b2.snapshot().some((n) => n.id === id)).toBe(false);
    const a2 = await connect(boardId, a.doc);
    await waitFor(() => b2.snapshot().some((n) => n.id === id), 'B receives the re-sent note');
    await waitForConvergence([a2, b2]);
    const after = await inRoom(boardId, (_r, state) => snapshot(fromStorage(state.storage)));
    expect(after).toEqual(a2.snapshot());
    expect(after).toHaveLength(2);
  });

  it('TC-17: a garbage update closes the sender 1003 and stores nothing', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const before = await inRoom(boardId, (_r, state) => count(state.storage, 'updates'));
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    syncProtocol.writeUpdate(e, new Uint8Array([1, 1, 5, 0, 200]));
    a.sendRaw(encoding.toUint8Array(e));
    await waitFor(() => a.closeCode !== null, 'sender closed');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await inRoom(boardId, (_r, state) => count(state.storage, 'updates'))).toBe(before);
  });
});

describe('BoardRoom load failure (persist.load_failure)', () => {
  it('TC-15: a damaged snapshot closes clients 4500 and stores nothing they send', async () => {
    const { boardId } = await snapshottedRetroBoard();
    await corruptSnapshot(boardId);
    const local = new Y.Doc();
    createSticky(local, { x: 1, y: 1 });
    const c = await open(boardId, local);
    c.sendRaw(syncStep2Frame(local));
    await waitFor(() => c.closeCode !== null, 'closed');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.synced).toBe(false);
    const rows = await inRoom(boardId, (room, state) => {
      expect(room.state).toBe('load-failed');
      expect(room.doc).toBeNull();
      return { updates: count(state.storage, 'updates'), quarantined: count(state.storage, 'quarantined_updates') };
    });
    expect(rows).toEqual({ updates: 0, quarantined: 0 });
  });

  it('TC-16: retries wait LOAD_RETRY_MIN_INTERVAL_MS; after repair the next connection loads and syncs', async () => {
    const { boardId, original, chunk0 } = await snapshottedRetroBoard();
    await corruptSnapshot(boardId);
    const first = await open(boardId);
    await waitFor(() => first.closeCode !== null, 'first closed');
    expect(first.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await inRoom(boardId, (room) => room.loadAttempts)).toBe(1);
    // Repair storage, but connect before the interval: still 4500, no reload attempt.
    await inRoom(boardId, (_r, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', chunk0);
    });
    const early = await open(boardId);
    await waitFor(() => early.closeCode !== null, 'early closed');
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await inRoom(boardId, (room) => room.loadAttempts)).toBe(1);
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS));
    const late = await connect(boardId);
    expect(late.snapshot()).toEqual(original);
    expect(late.closeCode).toBeNull();
    expect(await inRoom(boardId, (room) => ({ attempts: room.loadAttempts, state: room.state }))).toEqual({
      attempts: 2,
      state: 'ready',
    });
  });

  it('TC-26: an SQL error while loading puts the room in load-failed; new sockets close 4500', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    createSticky(a.doc, { x: 0, y: 0 });
    await a.barrier();
    await closeAndWait(a);
    const state = await inRoom(boardId, (room) => {
      room.createStore = (storage) =>
        new BoardStore({
          sql: {
            exec: (query: string, ...bindings: unknown[]) => {
              if (query.startsWith('SELECT')) throw new Error('injected read failure');
              return storage.sql.exec(query, ...(bindings as SqlStorageValue[]));
            },
          },
          transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
        } as unknown as DurableObjectStorage);
      room.load();
      return room.state;
    });
    expect(state).toBe('load-failed');
    const c = await open(boardId);
    await waitFor(() => c.closeCode !== null, 'closed');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.synced).toBe(false);
  });
});

describe('BoardRoom hibernation', () => {
  it('TC-18: after the object is evicted with sockets hibernated, messages still reach every socket', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    retroBoard(a.doc);
    await waitForConvergence([a, b]);
    await inRoom(boardId, (room) => {
      (room as unknown as { marker: string }).marker = 'before';
    });
    await evictDurableObject(stubFor(boardId)); // hibernate: sockets stay open
    const id = createSticky(a.doc, { x: 999, y: 999 }, 'violet');
    await waitFor(() => b.snapshot().some((n) => n.id === id), 'B receives after wake');
    await waitForConvergence([a, b]);
    expect(b.snapshot()).toHaveLength(26);
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();
    const woke = await inRoom(boardId, (room, state) => ({
      marker: (room as unknown as { marker?: string }).marker,
      attempts: room.loadAttempts,
      sockets: state.getWebSockets().length,
    }));
    expect(woke).toEqual({ marker: undefined, attempts: 1, sockets: 2 });
    // A late joiner gets the reloaded board plus the new note.
    const c = await connect(boardId);
    expect(c.snapshot()).toEqual(a.snapshot());
  });
});

describe('Test hooks are absent without TEST_HOOKS', () => {
  it('POST /__test/... is not routed to a room', async () => {
    const res = await SELF.fetch(`http://vidi6.test/__test/boards/${newBoardId()}/corrupt-snapshot`, { method: 'POST' });
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
    await res.arrayBuffer();
  });
});
