/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array
} from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC
} from '../../src/shared/protocol';
import type { BoardStore } from '../../src/worker/board-store';
import { BoardRoom } from '../../src/worker/board-room';
import type { Env } from '../../src/worker/index';
import { connectBoard, RoomClient, waitFor } from './ws-client';

const testEnv = env as unknown as Env;

const fetcher = SELF.fetch.bind(SELF);
const newId = () => crypto.randomUUID().slice(0, 8) + '-' + Date.now();

function sortById(notes: readonly StickySnapshot[]): StickySnapshot[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run a function against the live BoardRoom instance. Values crossing back
// must be structured-serialisable, so return plain data, never Y docs.
function inRoom<T>(boardId: string, fn: (room: BoardRoom) => T | Promise<T>): Promise<T> {
  return runInDurableObject(
    testEnv.BOARD_ROOM.get(testEnv.BOARD_ROOM.idFromName(boardId)),
    fn as unknown as (
      instance: BoardRoom,
      state: DurableObjectState
    ) => T | Promise<T>
  );
}

function countUpdates(boardId: string): Promise<number> {
  return inRoom(boardId, (room) => {
    const cursor = room.debugStore().sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM updates'
    );
    const first = cursor.next();
    return first.done ? 0 : first.value.count;
  });
}

// Rebuilds a doc from storage inside the DO and returns its encoded state.
function storageState(boardId: string): Promise<Uint8Array> {
  return inRoom(boardId, (room) => {
    const store = room.debugStore();
    const doc = new Y.Doc();
    store.migrate();
    const result = store.load(doc);
    if (!result.ok) throw new Error(`storage load failed: ${result.reason}`);
    return Y.encodeStateAsUpdate(doc);
  });
}

async function docFromStorage(boardId: string): Promise<Y.Doc> {
  const state = await storageState(boardId);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

function createNotes(client: RoomClient, count: number): void {
  for (let i = 0; i < count; i += 1) createSticky(client.doc, { x: i * 30, y: i * 20 });
}

describe('BoardRoom persistence (TC-12, TC-13, TC-18)', () => {
  it('TC-12 stores the update before the peer observes it', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    createSticky(a.doc, { x: 5, y: 5 });
    await waitFor(() => b.snapshot().length === 1);

    // By the time B saw the change, the row is already durable.
    expect(await countUpdates(boardId)).toBeGreaterThanOrEqual(1);

    a.closeNow();
    b.closeNow();
    await settle();

    const restored = await docFromStorage(boardId);
    expect(sortById(snapshot(restored))).toEqual(sortById(a.snapshot()));
  });

  it('TC-13 a reopened room serves the same board to a fresh client', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);
    createNotes(a, 25);
    await waitFor(() => b.snapshot().length === 25);
    const original = sortById(a.snapshot());

    a.closeNow();
    b.closeNow();
    await settle();

    // Simulate eviction, then a fresh client over the same storage.
    await inRoom(boardId, (room) => room.debugReload());
    const c = await connectBoard(fetcher, boardId);
    expect(sortById(c.snapshot())).toEqual(original);
    c.closeNow();
  });

  it('TC-18 broadcast reaches sockets accepted before a reconstruct', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    // Hibernation path: the room state is reconstructed while both sockets
    // stay open; broadcasts go out through ctx.getWebSockets().
    await inRoom(boardId, (room) => room.debugReload());

    createSticky(a.doc, { x: 3, y: 4 });
    await waitFor(() => b.snapshot().length === 1);
    expect(sortById(b.snapshot())).toEqual(sortById(a.snapshot()));

    a.closeNow();
    b.closeNow();
  });
});

describe('BoardRoom storage failure (TC-14)', () => {
  it('TC-14 an unsaved change is not broadcast and is recovered on reconnect', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    // One injected append failure: the change must not go out to B.
    type PatchedStore = BoardStore & { append?: (update: Uint8Array) => void };
    await inRoom(boardId, (room) => {
      const store = room.debugStore() as PatchedStore;
      store.append = () => {
        throw new Error('injected append failure');
      };
    });

    createSticky(a.doc, { x: 9, y: 9 });
    const [codeA, codeB] = await Promise.all([a.waitForClosed(), b.waitForClosed()]);
    expect(codeA).toBe(CLOSE_STORAGE_FAILURE);
    expect(codeB).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot()).toHaveLength(0); // never received the unsaved change

    // Restore storage; A still holds the change and retries it on reconnect.
    await inRoom(boardId, (room) => {
      const patched: { append?: (update: Uint8Array) => void } = room.debugStore();
      delete patched.append; // reveals the prototype method again
    });

    await a.reconnect(fetcher, `https://example.com/api/rooms/${boardId}`);
    await a.waitForSync();
    expect(await countUpdates(boardId)).toBeGreaterThanOrEqual(1);

    const b2 = await connectBoard(fetcher, boardId);
    expect(sortById(b2.snapshot())).toEqual(sortById(a.snapshot()));
    a.closeNow();
    b2.closeNow();
  });
});

describe('BoardRoom load failure (TC-15, TC-16, TC-26)', () => {
  async function boardWithCorruptSnapshot(): Promise<string> {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    createNotes(a, 25);
    await a.waitForSync();
    await inRoom(boardId, (room) => room.debugCompact());
    a.closeNow();
    await settle();
    await inRoom(boardId, (room) => room.debugStore().debugCorruptChunk0());
    await inRoom(boardId, (room) => room.debugReload());
    return boardId;
  }

  it('TC-15 a damaged snapshot closes with 4500 and stores nothing', async () => {
    const boardId = await boardWithCorruptSnapshot();
    expect((await inRoom(boardId, (room) => room.debugState())).state).toBe('load-failed');

    const client = await RoomClient.connect(
      fetcher,
      `https://example.com/api/rooms/${boardId}`
    );
    // A SyncStep2 carrying a change arrives before/around the close: the
    // load-failed room must apply nothing.
    createSticky(client.doc, { x: 1, y: 1 });
    const code = await client.waitForClosed();
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
    await settle();
    expect(await countUpdates(boardId)).toBe(0);
  });

  it('TC-16 reconnect is throttled, and loads once the storage is repaired', async () => {
    const boardId = await boardWithCorruptSnapshot();
    const before = await inRoom(boardId, (room) => room.debugState());

    // Within LOAD_RETRY_MIN_INTERVAL_MS: closed 4500, no reload attempt.
    const early = await RoomClient.connect(
      fetcher,
      `https://example.com/api/rooms/${boardId}`
    );
    expect(await early.waitForClosed()).toBe(CLOSE_BOARD_LOAD_FAILED);
    const during = await inRoom(boardId, (room) => room.debugState());
    expect(during.loadAttempts).toBe(before.loadAttempts);

    // Repair and simulate the retry window having passed.
    await inRoom(boardId, (room) => room.debugStore().debugRepairChunk0());
    await inRoom(boardId, (room) => room.debugSetLastLoadFailedAt(0));

    const client = await connectBoard(fetcher, boardId);
    expect(client.snapshot()).toHaveLength(25);
    const after = await inRoom(boardId, (room) => room.debugState());
    expect(after.state).toBe('ready');
    expect(after.loadAttempts).toBe(before.loadAttempts + 1);
    client.closeNow();
  });

  it('TC-26 an SQL read failure on load closes new sockets with 4500', async () => {
    const boardId = newId();
    await inRoom(boardId, (room) => {
      room.debugSetStore({
        migrate() {},
        load() {
          return { ok: false, reason: 'sql-error', error: 'injected SELECT failure' };
        }
      } as unknown as BoardStore);
    });
    await inRoom(boardId, (room) => room.debugReload());

    const client = await RoomClient.connect(
      fetcher,
      `https://example.com/api/rooms/${boardId}`
    );
    expect(await client.waitForClosed()).toBe(CLOSE_BOARD_LOAD_FAILED);
    const state = await inRoom(boardId, (room) => room.debugState());
    expect(state.state).toBe('load-failed');
  });
});

describe('BoardRoom garbage (TC-17)', () => {
  it('TC-17 a garbage update closes with 1003 and is not stored', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const before = await countUpdates(boardId);

    // A real update truncated mid-struct: decodes as a sync update but the
    // apply fails, so the socket is closed and nothing is appended.
    const src = new Y.Doc();
    src.getMap('x').set('k', 'some content long enough to truncate safely');
    const full = Y.encodeStateAsUpdate(src);
    const damaged = full.slice(0, full.length - 12);
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    writeVarUint(encoder, 1); // sync update tag
    writeVarUint8Array(encoder, damaged);
    a.sendRaw(toUint8Array(encoder));

    expect(await a.waitForClosed()).toBe(CLOSE_UNSUPPORTED_DATA);
    await settle();
    expect(await countUpdates(boardId)).toBe(before);
  });
});
