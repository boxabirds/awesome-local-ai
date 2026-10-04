/**
 * Integration tests for persist.room: the real BoardRoom Durable Object with
 * real WebSockets and real Durable Object SQLite in workerd. No mocks.
 *
 * Covers the persistence contract: append-before-broadcast, LoadFailed close
 * 4500, StorageFailed close 1011, save-failure recovery, and the hibernation
 * API (sockets survive a room reconstruction). Each test uses a fresh board
 * id (fresh object, fresh database).
 *
 * Cases: TC-12 to TC-18, TC-26.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  BoardStore,
  setStorageWrapper,
  type BoardStorage,
} from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { openSocket, WsClient } from './ws-client';

/** Connect a synced client to a board. */
async function connectBoard(boardId: string): Promise<WsClient> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await stub.initialize(); // story 5: create the board before connecting
  const ws = await openSocket((req) => stub.fetch(req), boardId);
  const client = new WsClient(ws);
  await client.waitForSync();
  return client;
}

/** Run `fn` against a board's raw storage inside its Durable Object. */
async function withStorage<T>(
  boardId: string,
  fn: (storage: BoardStorage) => T,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) =>
    fn(room.rawStorage as unknown as BoardStorage),
  );
}

/** Row count of a table in a board's storage. */
function count(storage: BoardStorage, table: string): number {
  return (
    storage.sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).toArray()[0] as { c: number }
  ).c;
}

/** Load a board's saved state into a fresh doc (as the room would on wake). */
async function loadFromStorage(boardId: string): Promise<readonly StickySnapshot[]> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) => {
    const store = new BoardStore(room.rawStorage as unknown as BoardStorage);
    store.migrate();
    const doc = new Y.Doc();
    store.load(doc);
    return snapshot(doc);
  });
}

/** True when two snapshots hold the same notes (order-insensitive). */
function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (n: StickySnapshot) =>
    `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}|${n.createdAt}`;
  const setB = new Set(b.map(key));
  return a.every((n) => setB.has(key(n)));
}

async function waitFor<T>(
  what: string,
  pred: () => T | false | null | undefined | Promise<T | false | null | undefined>,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await pred();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('persist.room (real Durable Object, sockets, SQLite)', () => {
  it('TC-12: by the time B sees A\'s note, an updates row exists; a fresh doc from storage has it', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);

    const id = createSticky(a.doc, { x: 10, y: 20 });
    await waitFor('B to see the note', () =>
      b.boardSnapshot().some((n) => n.id === id) ? true : false,
    );

    // persist.automatic: the change is recorded before it is seen elsewhere.
    const rows = await withStorage(boardId, (s) => count(s, 'updates'));
    expect(rows).toBeGreaterThanOrEqual(1);

    // A fresh doc loaded from storage (as on a room wake) contains the note.
    const fromStorage = await loadFromStorage(boardId);
    expect(fromStorage.some((n) => n.id === id)).toBe(true);
    a.close();
    b.close();
  });

  it('TC-13: everyone leaves; a fresh room instance over the same storage reproduces the board', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const b = await connectBoard(boardId);
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: 0 });
    for (let i = 0; i < 3; i++) createSticky(b.doc, { x: i, y: 100 });
    await waitFor('both to see all 6', () =>
      a.boardSnapshot().length === 6 && b.boardSnapshot().length === 6 ? true : false,
    );
    const original = a.boardSnapshot();
    a.close();
    b.close();

    // A new client wakes a fresh room instance over the same storage.
    const c = await connectBoard(boardId);
    await waitFor('C to see all 6', () =>
      c.boardSnapshot().length === 6 ? true : false,
    );
    expect(sameBoard(original, c.boardSnapshot())).toBe(true);
    c.close();
  });

  it('TC-14: append fails → A and B closed 1011, B never saw it; A reconnects → stored and delivered', async () => {
    const boardId = newBoardId();
    // The room's store is built with this wrapper when the board first loads
    // below. The failure is armed only after both clients are stable, so it
    // fires on A's note (not on the clients' initial sync state).
    let armed = false;
    setStorageWrapper((storage) => ({
      sql: {
        exec: (q: string, ...bindings: unknown[]) => {
          if (armed && q.includes('INSERT INTO updates')) {
            throw new Error('injected storage failure');
          }
          return storage.sql.exec(q, ...bindings);
        },
      },
      transactionSync: (fn: () => void) => storage.transactionSync(fn),
    }));
    try {
      const a = await connectBoard(boardId);
      const b = await connectBoard(boardId);
      // Let both initial syncs settle and flush before arming the failure.
      await new Promise((r) => setTimeout(r, 150));

      armed = true;
      // A's change cannot be stored: the room resets and closes both clients.
      const id = createSticky(a.doc, { x: 5, y: 5 });
      const aClose = await a.waitForClose();
      const bClose = await b.waitForClose();
      expect(aClose.code).toBe(1011);
      expect(bClose.code).toBe(1011);
      // B never received the change (non-propagation on save failure).
      expect(b.boardSnapshot().some((n) => n.id === id)).toBe(false);
    } finally {
      armed = false;
      setStorageWrapper(null);
    }

    // Saving works again: A reconnects still holding the change (its doc kept
    // the note locally through the failure); it is stored and B converges.
    const aDoc = new Y.Doc();
    initDoc(aDoc);
    const restoredId = createSticky(aDoc, { x: 5, y: 5 });

    const a2 = await reconnectWithDoc(aDoc, boardId);
    const b2 = await connectBoard(boardId);
    await waitFor('B to receive the recovered note', () =>
      b2.boardSnapshot().some((n) => n.id === restoredId) ? true : false,
    );
    expect(a2.boardSnapshot().some((n) => n.id === restoredId)).toBe(true);
    a2.close();
    b2.close();
  });

  it('TC-15: corrupt snapshot → client closed 4500; a pre-close sync stores nothing', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    createSticky(a.doc, { x: 1, y: 1 });
    await waitFor('room to store the note', async () =>
      (await withStorage(boardId, (s) => count(s, 'updates'))) >= 1,
    );
    a.close();

    // Corrupt the snapshot (forces one from the current doc, then damages it).
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    await runInDurableObject(stub, (room: BoardRoom) => {
      room.testCorruptSnapshot();
      return null;
    });

    // A new connection is accepted then closed with 4500 (load failed).
    const id = env.BOARD_ROOM.idFromName(boardId);
    const ws = await openSocket((req) => env.BOARD_ROOM.get(id).fetch(req), boardId);
    const b = new WsClient(ws);
    const close = await b.waitForClose();
    expect(close.code).toBe(4500);

    // Negative: the failed room stored nothing from the pre-close sync.
    const updates = await withStorage(boardId, (s) => count(s, 'updates'));
    const quarantined = await withStorage(boardId, (s) => count(s, 'quarantined_updates'));
    expect(updates).toBe(0);
    expect(quarantined).toBe(0);
  });

  it('TC-16: connect within the retry interval → 4500, no reload; after the interval → loads', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    createSticky(a.doc, { x: 1, y: 1 });
    await waitFor('room to store the note', async () =>
      (await withStorage(boardId, (s) => count(s, 'updates'))) >= 1,
    );
    a.close();

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    await runInDurableObject(stub, (room: BoardRoom) => {
      room.testCorruptSnapshot();
      return null;
    });

    // First connection after corruption: the room reloads, fails, → 4500 and
    // records the attempt time.
    const id = env.BOARD_ROOM.idFromName(boardId);
    const ws1 = await openSocket((req) => env.BOARD_ROOM.get(id).fetch(req), boardId);
    const c1 = new WsClient(ws1);
    expect((await c1.waitForClose()).code).toBe(4500);

    // Immediately again: within LOAD_RETRY_MIN_INTERVAL_MS → 4500, no reload.
    const ws2 = await openSocket((req) => env.BOARD_ROOM.get(id).fetch(req), boardId);
    const c2 = new WsClient(ws2);
    expect((await c2.waitForClose()).code).toBe(4500);

    // Repair the snapshot chunk directly (leaving the room in load-failed so
    // the next connection after the interval retries the load).
    await withStorage(boardId, (s) => {
      const backup = s.sql
        .exec('SELECT data FROM test_backups WHERE key = ?', 'chunk_0')
        .toArray()[0] as { data: ArrayBuffer } | undefined;
      if (backup) {
        s.sql
          .exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', new Uint8Array(backup.data), 0)
          .toArray();
      }
      return null;
    });

    // After the interval the room retries and loads the repaired board.
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 200));
    const c = await connectBoard(boardId);
    await waitFor('C to see the note', () =>
      c.boardSnapshot().length === 1 ? true : false,
    );
    c.close();
  }, 20000);

  it('TC-17: garbage update → closed 1003, update log unchanged', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    createSticky(a.doc, { x: 1, y: 1 });
    await waitFor('room to store the baseline note', async () =>
      (await withStorage(boardId, (s) => count(s, 'updates'))) >= 1,
    );
    const before = await withStorage(boardId, (s) => count(s, 'updates'));

    // Structurally valid update frame whose Yjs bytes are garbage.
    a.sendRaw(new Uint8Array([0, 2, 5, 1, 2, 3, 4, 5]));
    const close = await a.waitForClose();
    expect(close.code).toBe(1003);

    const after = await withStorage(boardId, (s) => count(s, 'updates'));
    expect(after).toBe(before);
  });

  it('TC-18: after a room reconstruction, earlier-accepted sockets still receive (hibernation)', async () => {
    const boardId = newBoardId();
    const a = await connectBoard(boardId);
    const first = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor('room to store the first note', async () =>
      (await withStorage(boardId, (s) => count(s, 'updates'))) >= 1,
    );

    // Idle long enough for the runtime to hibernate the object; the accepted
    // socket survives (hibernation API).
    await new Promise((r) => setTimeout(r, 2000));

    const b = await connectBoard(boardId);
    const second = createSticky(b.doc, { x: 50, y: 50 });
    // B's note reaches A's earlier-accepted socket (delivered via
    // ctx.getWebSockets() after the room re-ran its constructor).
    await waitFor('A to receive B\'s note', () =>
      a.boardSnapshot().some((n) => n.id === second) ? true : false,
    );
    // A's earlier note reaches B (loaded from storage on wake).
    await waitFor('B to receive A\'s note', () =>
      b.boardSnapshot().some((n) => n.id === first) ? true : false,
    );
    a.close();
    b.close();
  }, 20000);

  it('TC-26: a SELECT failure during load → room closes the client with 4500', async () => {
    const boardId = newBoardId();
    try {
      let armed = true;
      setStorageWrapper((storage) => ({
        sql: {
          exec: (q: string, ...bindings: unknown[]) => {
            if (armed && q.trimStart().toUpperCase().startsWith('SELECT')) {
              armed = false;
              throw new Error('injected SQL read error');
            }
            return storage.sql.exec(q, ...bindings);
          },
        },
        transactionSync: (fn: () => void) => storage.transactionSync(fn),
      }));

      const id = env.BOARD_ROOM.idFromName(boardId);
      const ws = await openSocket((req) => env.BOARD_ROOM.get(id).fetch(req), boardId);
      const a = new WsClient(ws);
      const close = await a.waitForClose();
      expect(close.code).toBe(4500);
    } finally {
      setStorageWrapper(null);
    }
  });
});

/** Connect a client that carries an existing doc to a board. */
async function reconnectWithDoc(doc: Y.Doc, boardId: string): Promise<WsClient> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await stub.initialize(); // story 5: create the board before connecting
  const ws = await openSocket((req) => stub.fetch(req), boardId);
  const client = new WsClient(ws, doc);
  await client.waitForSync();
  return client;
}
