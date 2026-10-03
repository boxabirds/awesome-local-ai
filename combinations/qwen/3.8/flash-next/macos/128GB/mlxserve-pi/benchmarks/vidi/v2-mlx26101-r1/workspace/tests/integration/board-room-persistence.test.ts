// persist.room integration tests: the real, now-persistent BoardRoom Durable
// Object, real hibernating WebSockets, real Yjs and real SQLite-backed storage,
// driven through the Worker's own route. These cover the guarantees story 4 adds
// on top of story 3's live relay — that a change is durable before anyone else can
// see it, that a board comes back after everyone leaves, and that load and save
// failures surface to clients with the right close codes instead of a lost board.

import { describe, expect, it } from 'vitest';
import { SELF, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/board-room';
import { damagedGarbage } from '../fixtures/boards';
import { RoomClient } from './helpers/ws-client';
import { bindings, createRoom, waitForRoom } from './helpers/room';
import { runStore } from './helpers/store';

/** Compare two boards by id, ignoring render order (all fields must match). */
function sortById(notes: readonly StickySnapshot[]): readonly StickySnapshot[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function boardIdStub(boardId: string) {
  return bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
}

/**
 * Read the board straight out of the board's storage into a fresh document, using a
 * store that is independent of the room's. Proves what is *durable*, not what is
 * only in the room's memory.
 */
async function storedNotes(boardId: string): Promise<readonly StickySnapshot[]> {
  const { result } = await runStore(({ store, loadInto }) => {
    store.migrate();
    const { doc, notes } = loadInto();
    store.load(doc);
    return JSON.parse(JSON.stringify(notes())) as StickySnapshot[];
  }, boardId);
  return result;
}

/**
 * Connect a raw client socket to a board and resolve with the close code the room
 * hands it. Used for rooms that refuse the connection (load-failed): the socket is
 * accepted and immediately closed, so a full RoomClient handshake would throw.
 */
async function refusalCloseCode(boardId: string): Promise<number> {
  const response = await SELF.fetch(`https://example.com/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) throw new Error(`no WebSocket in upgrade response (status ${response.status})`);
  ws.accept();
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`client ${boardId} socket never closed`)),
      5_000,
    );
    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      resolve((event as CloseEvent).code);
    });
  });
}

/** Build `count` distinct notes on `client`'s document and return their ids. */
function makeNotes(client: RoomClient, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(createSticky(client.doc, { x: i * 40, y: 0 }, 'yellow'));
  }
  return ids;
}

describe('a change is durable before it is seen (TC-12)', () => {
  it('TC-12 stores an update before another client can observe it', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const noteId = makeNotes(a, 1)[0]!;
    // The moment B can see the note, it is already on disk: the room wrote it before
    // it broadcast, so nobody ever sees a change that is not durably saved.
    await b.waitForDoc((n) => n.some((note) => note.id === noteId), 'b sees the note');

    const onDisk = await storedNotes(boardId);
    expect(onDisk.map((n) => n.id)).toContain(noteId);

    a.close();
    b.close();
  });
});

describe('a board comes back after everyone leaves (TC-13)', () => {
  it('TC-13 restores the whole board on a fresh room instance', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForSync();
    makeNotes(a, 25);
    // Wait until the room itself has applied (and therefore stored) every note.
    const original = await waitForRoom(boardId, (n) => n.length === 25, 'room stored 25');

    // The last person leaves and the object is evicted — in-memory document gone.
    a.close();
    await a.waitForClose();
    await evictDurableObject(boardIdStub(boardId), { webSockets: 'close' });

    // A brand new person opens the board: the room is a fresh instance that read the
    // board straight out of storage. It is exactly what was left.
    const c = await RoomClient.connect(boardId);
    await c.waitForSync();
    await c.waitForDoc((n) => n.length === 25, 'fresh instance restored 25 notes');
    expect(sortById(c.snapshot())).toEqual(sortById(original));

    c.close();
  });
});

describe('a change that cannot be saved is not seen (TC-14)', () => {
  it('TC-14 closes every socket on a save failure and recovers on reconnect', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Arm the room's store to fail the *next* write once (the real disk failure the
    // design cannot conjure on demand), at the seam outside SQLite.
    await runInDurableObject(boardIdStub(boardId), (instance: BoardRoom) => {
      const store = (instance as unknown as { store: BoardStoreLike }).store;
      const original = store.append.bind(store);
      let armed = true;
      store.append = (update: Uint8Array) => {
        if (armed) {
          armed = false;
          throw new Error('injected disk-full');
        }
        original(update);
      };
    });

    const noteId = makeNotes(a, 1)[0]!;

    // The save fails: both sockets are closed with CLOSE_STORAGE_FAILURE, and B never
    // received the change (an unsaved change is never shown to anyone).
    const aCode = await a.waitForClose();
    const bCode = await b.waitForClose();
    expect(aCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(bCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot().some((n) => n.id === noteId)).toBe(false);

    // A still holds the change in its own document. A reconnects first, the room
    // reloads what *is* on disk, A re-sends the change through the sync handshake,
    // it saves this time, and only then reaches B.
    await a.reconnect();
    await a.waitForSync();
    await b.reconnect();
    await b.waitForSync();
    await b.waitForDoc((n) => n.some((note) => note.id === noteId), 'b finally sees it');

    // And it is durable now.
    const onDisk = await storedNotes(boardId);
    expect(onDisk.map((n) => n.id)).toContain(noteId);

    a.close();
    b.close();
  });
});

describe('an unreadable board refuses clients (TC-15)', () => {
  it('TC-15 closes a client with 4500 and stores nothing on a corrupt snapshot', async () => {
    const boardId = newBoardId();
    // Seed a board whose notes live in a snapshot, then corrupt chunk 0.
    const { result: goodBytes } = await runStore(({ store, storage }) => {
      store.migrate();
      const doc = new Y.Doc();
      for (let i = 0; i < 25; i++) createSticky(doc, { x: i * 40, y: 0 }, 'yellow');
      const encoded = Y.encodeStateAsUpdate(doc);
      storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        0,
        encoded,
      );
      // Corrupt it in place: random bytes of the same shape that cannot apply.
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        damagedGarbage(encoded.length),
      );
      return Array.from(encoded);
    }, boardId);
    expect(goodBytes.length).toBeGreaterThan(0);

    // Force the room to re-read the (now unreadable) storage on next wake.
    await evictDurableObject(boardIdStub(boardId), { webSockets: 'close' });

    // A client is refused with CLOSE_BOARD_LOAD_FAILED rather than shown an empty board.
    const code = await refusalCloseCode(boardId);
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Nothing was stored or quarantined by the refused connection: the room never
    // served or wrote an empty doc.
    const probe = await runStore(({ probe }) => probe(), boardId).then((r) => r.result);
    expect(probe.counts.quarantined_updates).toBe(0);
    expect(probe.counts.updates).toBe(0);
  });
});

describe('load failures retry on a throttled cadence (TC-16)', () => {
  it('TC-16 refuses before the retry interval and recovers after a repair', async () => {
    const boardId = newBoardId();
    // The board exists first (story 5): a load failure must be refused with the
    // load-failure code, which is a different thing from refusing a link that was
    // never issued. Creating it is also what gives the seeding below its tables.
    await createRoom(boardId);
    // Seed a corrupt snapshot and remember the good bytes for the repair.
    const { result } = await runStore(({ storage }) => {
      const doc = new Y.Doc();
      for (let i = 0; i < 25; i++) createSticky(doc, { x: i * 40, y: 0 }, 'yellow');
      const encoded = Y.encodeStateAsUpdate(doc);
      storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        0,
        encoded,
      );
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        damagedGarbage(encoded.length),
      );
      return Array.from(encoded);
    }, boardId);
    const good = new Uint8Array(result);

    await evictDurableObject(boardIdStub(boardId), { webSockets: 'close' });

    // First attempt fails (this is what puts the room into load-failed and stamps the
    // retry clock).
    expect(await refusalCloseCode(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);

    // A second attempt inside LOAD_RETRY_MIN_INTERVAL_MS is refused too, without the
    // room re-reading storage every reconnect (the retry clock is why).
    expect(await refusalCloseCode(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the storage, then wind the retry clock so the next attempt is allowed.
    await runStore(({ storage }) => {
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        good,
      );
      return null;
    }, boardId);
    await runInDurableObject(boardIdStub(boardId), (instance: BoardRoom) => {
      (instance as unknown as { loadFailedAt: number }).loadFailedAt = 0;
    });

    // The next connection loads the repaired board and syncs — no reload needed.
    const client = await RoomClient.connect(boardId);
    await client.waitForSync();
    await client.waitForDoc((n) => n.length === 25, 'the repaired board loads and syncs');

    client.close();
  });
});

describe('rejected garbage is never stored (TC-17)', () => {
  it('TC-17 closes an undecodable update with 1003 and writes no row', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForSync();
    const before = (await runStore(({ probe }) => probe(), boardId).then((r) => r.result))
      .counts.updates;

    // A sync "update" frame that claims a 10-byte payload but has none: Yjs rejects
    // it, so the room closes the socket and stores nothing.
    a.sendBytes(new Uint8Array([0, 2, 10]));

    const code = await a.waitForClose();
    expect(code).toBe(CLOSE_UNSUPPORTED_DATA);

    const after = (await runStore(({ probe }) => probe(), boardId).then((r) => r.result))
      .counts.updates;
    expect(after).toBe(before);
  });
});

describe('hibernated sockets still receive broadcasts (TC-18)', () => {
  it('TC-18 delivers to a socket accepted before the object was reconstructed', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    await a.waitForSync();
    await b.waitForSync();
    makeNotes(a, 3);
    await b.waitForDoc((n) => n.length === 3, 'b has the first 3 notes');

    // The object is torn down; its WebSockets are *hibernated*, not closed. B is
    // still connected from its side, and the board now lives only in storage.
    await evictDurableObject(boardIdStub(boardId));

    // A makes a change. The act of sending wakes a fresh room instance, which reads
    // the stored board and then broadcasts the new note over the reattached set
    // returned by ctx.getWebSockets() — reaching B's hibernated socket.
    const note4 = createSticky(a.doc, { x: 999, y: 999 }, 'pink');
    await b.waitForDoc(
      (n) => n.some((note) => note.id === note4),
      'the hibernated socket did not receive the post-reconstruct broadcast',
    );
    // B also still has the three notes that were only in storage across the eviction.
    expect(b.snapshot()).toHaveLength(4);

    a.close();
    b.close();
  });
});

describe('a SQL read failure refuses clients (TC-26)', () => {
  it('TC-26 closes a new socket with 4500 when load reports sql-error', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForSync();
    makeNotes(a, 25);
    await waitForRoom(boardId, (n) => n.length === 25, 'board is stored');

    // Inject a load failure at the store seam and drop the room back into the state
    // where its next connection has to reload its document, so the reload runs through
    // the failing load (the same path a wake-from-hibernation would take).
    await runInDurableObject(boardIdStub(boardId), (instance: BoardRoom) => {
      const room = instance as unknown as {
        store: { load: () => { ok: false; reason: string; error: string } };
        roomDoc: unknown;
        state: string;
      };
      room.store.load = () => ({
        ok: false,
        reason: 'sql-error',
        error: 'injected read failure',
      });
      room.roomDoc = null;
      room.state = 'storage-failed';
    });

    // The reload hits the injected read failure → the room refuses the socket with the
    // load-failure code rather than serving an empty board.
    expect(await refusalCloseCode(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});

/** The subset of BoardStore the tests poke at their own append method. */
interface BoardStoreLike {
  append(update: Uint8Array): void;
}
