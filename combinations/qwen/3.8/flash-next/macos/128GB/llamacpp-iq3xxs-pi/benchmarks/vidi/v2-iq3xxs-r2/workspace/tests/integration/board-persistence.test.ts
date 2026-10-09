import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createSticky, initDoc, moveObject } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import type { BoardStore } from '../../src/worker/board-store';
import type { RoomState } from '../../src/worker/room-state';
import {
  connectClients,
  disconnectClients,
  settle,
  TestClient as newClient,
  updateFrame,
  waitForConvergence,
} from './helpers/ws-client';

/**
 * Story 4's room (`persist.*`) against real Durable Object SQLite and real
 * WebSockets: the storage is real storage, the evictions are real evictions, and the
 * injected failures run through production code paths the room itself takes
 * (`BoardStore.testBeforeExec`, a wrapped `store.append`) — nothing is faked at the
 * storage boundary (design's mock-vs-real table, again: no mocks).
 */

/** The room's private parts, exposed the way a woken object holds them. */
interface RoomInternals {
  store: BoardStore;
  state: RoomState;
  lastLoadFailureAt: number;
  loadNow(): void;
}

/** Run inside the live room object (creating it if needed), without a socket. */
async function inRoom<T>(boardId: string, fn: (room: RoomInternals) => T): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (instance) => fn(instance as unknown as RoomInternals));
}

/** How many sockets the room currently holds (hibernated ones included). */
async function socketCount(boardId: string): Promise<number> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_instance, state) => state.getWebSockets().length);
}

async function rowCount(boardId: string, table: 'updates' | 'snapshot_chunks'): Promise<number> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_instance, state) => {
    // `table` is a literal at every call site below, never input.
    return state.storage.sql
      .exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)
      .one().total;
  });
}

async function evict(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await evictDurableObject(stub);
}

/** One client, one note, saved, the client gone: a board with one row of history. */
async function boardWithOneNote(): Promise<string> {
  const boardId = newBoardId();
  const [a] = await connectClients(boardId, 1);
  try {
    initDoc(a.doc);
    createSticky(a.doc, { x: 20, y: 10 });
    await settle();
  } finally {
    await disconnectClients([a]);
  }
  return boardId;
}

  /**
 * A read of the update log that fails *for the next room object too*: the damage
 * lives in the storage itself, so it survives an eviction — unlike anything injected
 * into a live object's memory. `migrate` re-creates a missing table, so the table is
 * left present with the wrong columns: `SELECT seq, data, bytes FROM updates` is a
 * real SQL error (`no such column`), served from real storage.
 */
async function breakLogTable(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('ALTER TABLE updates RENAME TO updates_behind');
    state.storage.sql.exec('CREATE TABLE updates (wrong TEXT)');
  });
}

/** Put the real log back: after this, a load can succeed again. */
async function healLogTable(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('DROP TABLE updates');
    state.storage.sql.exec('ALTER TABLE updates_behind RENAME TO updates');
  });
}

async function rowsIn(boardId: string, table: 'updates' | 'updates_behind'): Promise<number> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)
      .one().total,
  );
}

describe('board persistence', () => {
  // TC-12: the row exists in the same synchronous turn as the broadcast, before it;
  // this observes the moment between.
  it('TC-12 stores an update before broadcasting it', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    try {
      initDoc(a.doc);
      const observations = await inRoom(boardId, (room) => {
        const store = room.store;
        const storage = (store as unknown as { storage: DurableObjectStorage }).storage;
        const realAppend = store.append.bind(store);
        const seen: Array<{ rows: number; bNotes: number }> = [];
        store.append = (update: Uint8Array) => {
          realAppend(update);
          // After the INSERT, before any broadcast: the row is there, and B has
          // rendered nothing of what has not even been sent yet.
          seen.push({
            rows: storage.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM updates').one()
              .total,
            bNotes: b.notes().length,
          });
        };
        return seen;
      });
      createSticky(a.doc, { x: 5, y: 5 });
      await b.waitUntil('the note', () => b.notes().length === 1);
      const noteAppends = observations.filter((observation) => observation.rows >= 1);
      expect(noteAppends.length).toBeGreaterThan(0);
      for (const observation of noteAppends) {
        expect(observation.bNotes).toBe(0); // stored before B saw it
      }
      expect(await rowCount(boardId, 'updates')).toBe(observations.length);
      await waitForConvergence([a, b]);
    } finally {
      await disconnectClients([a, b]);
    }
  });

  // TC-13: everything the last person left is there when the next one arrives —
  // through a real eviction and a real re-creation of the room object.
  it('TC-13 reloads a board of 25 notes identically in a new room instance', async () => {
    const boardId = newBoardId();
    const [a] = await connectClients(boardId, 1);
    try {
      initDoc(a.doc);
      for (let i = 0; i < 25; i++) {
        createSticky(a.doc, { x: i * 40, y: (i % 5) * 40 });
      }
      await settle();
    } finally {
      await disconnectClients([a]);
    }
    const prober = await newClient.connect(boardId);
    await prober.waitUntil('the 25 notes', () => prober.notes().length === 25);
    const before = prober.notes();
    await disconnectClients([prober]);
    await evict(boardId); // nobody connected; the room object goes away for good
    const joiner = await newClient.connect(boardId);
    try {
      await joiner.waitUntil('the 25 notes again', () => joiner.notes().length === 25);
      expect(joiner.notes()).toEqual(before);
    } finally {
      await disconnectClients([joiner]);
    }
  });

  // TC-14: a storage write that throws costs the room its document, not the board.
  it('TC-14 survives an append failure with 1011 and refills on reconnect', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    try {
      initDoc(a.doc);
      await waitForConvergence([a, b]);
      const rowsBefore = await rowCount(boardId, 'updates');
      let injected = false;
      await inRoom(boardId, (room) => {
        const store = room.store;
        const realAppend = store.append.bind(store);
        store.append = (update: Uint8Array) => {
          if (!injected) {
            injected = true;
            throw new Error('injected disk failure'); // like real disk, inside the same statement
          }
          return realAppend(update);
        };
      });
      // The change that cannot be saved is not broadcast, and the room drops its doc.
      createSticky(a.doc, { x: 80, y: 80 });
      await a.waitUntil('A to be dropped', () => !a.isOpen, 5000);
      await b.waitUntil('B to be dropped too', () => !b.isOpen, 5000);
      expect(a.lastClose?.code).toBe(CLOSE_STORAGE_FAILURE);
      expect(b.lastClose?.code).toBe(CLOSE_STORAGE_FAILURE);
      expect(await rowCount(boardId, 'updates')).toBe(rowsBefore); // the failing update was not stored
      expect(await inRoom(boardId, (room) => room.state)).toBe('storage-failed');

      // The reconnection handshakes bring the change back from the client that made it.
      await a.open();
      await b.open();
      await waitForConvergence([a, b]);
      expect(a.notes().length).toBe(1);
      expect(b.notes().length).toBe(1);
      expect(await rowCount(boardId, 'updates')).toBeGreaterThan(rowsBefore); // and append works again
      const id = b.notes()[0]?.id;
      if (!id) throw new Error('the note did not come back');
      moveObject(b.doc, id, 300, 300);
      await waitForConvergence([a, b]);
      expect(a.notes()[0]?.x).toBe(300);
    } finally {
      await disconnectClients([a, b]);
    }
  });

  // TC-15: a load-failed room stores nothing it is told to do; it only says so. The
  // failure is real storage damage, met by the room's own load on wake.
  it('TC-15 stores nothing from a socket it closes with 4500', async () => {
    const boardId = await boardWithOneNote();
    const rows = await rowsIn(boardId, 'updates');
    await breakLogTable(boardId);
    await evict(boardId); // the damage is in the storage: the next room object faces it

    const client = await newClient.connect(boardId); // wake load fails; 101, then 4500
    try {
      // Whatever this socket sends — here a well-formed SyncStep2 — is closed away,
      // not stored.
      client.send(updateFrame(new Uint8Array([0])));
      await client.waitUntil('the 4500 close', () => client.closes.length > 0);
      expect(client.lastClose?.code).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(await rowsIn(boardId, 'updates_behind')).toBe(rows); // not one row gained
      expect(await inRoom(boardId, (room) => room.state)).toBe('load-failed');
    } finally {
      await disconnectClients([client]);
    }
  });

  // TC-16: while the room refuses connections with 4500 it must not even *try* to
  // load until `LOAD_RETRY_MIN_INTERVAL_MS` have passed; then the next socket gets
  // the board, for real. The refusal is proven honest from the other side: the log
  // table is healed mid-test, so any reload inside the interval would have brought
  // the board back — and does not, until the interval has passed.
  it('TC-16 retries loading at most once per interval', async () => {
    const boardId = await boardWithOneNote();
    await breakLogTable(boardId);
    await evict(boardId);

    // Three sockets inside the retry interval: each is met with 4500 and nothing else.
    for (let attempt = 0; attempt < 3; attempt++) {
      const refused = await newClient.connect(boardId);
      try {
        await refused.waitUntil('the 4500 close', () => refused.closes.length > 0);
        expect(refused.lastClose?.code).toBe(CLOSE_BOARD_LOAD_FAILED);
      } finally {
        await disconnectClients([refused]);
      }
    }

    // The storage can load again — but not yet: still inside the interval, so the
    // room refuses without trying, and the board stays away.
    await healLogTable(boardId);
    const stillRefused = await newClient.connect(boardId);
    try {
      await stillRefused.waitUntil('the 4500 close', () => stillRefused.closes.length > 0);
      expect(stillRefused.lastClose?.code).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(await inRoom(boardId, (room) => room.state)).toBe('load-failed');
    } finally {
      await disconnectClients([stillRefused]);
    }

    // Past the interval: the next connection loads the board and syncs it.
    await inRoom(boardId, (room) => {
      room.lastLoadFailureAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS - 1;
    });
    const joiner = await newClient.connect(boardId);
    try {
      await joiner.waitUntil('the saved note', () => joiner.notes().length === 1);
    } finally {
      await disconnectClients([joiner]);
    }
  });

  // TC-17: story 3's refusal still holds on a persistent room — the bad update is
  // not stored by anything.
  it('TC-17 stores nothing for a rejected update', async () => {
    const boardId = await boardWithOneNote();
    const rows = await rowCount(boardId, 'updates');
    const a = await newClient.connect(boardId);
    try {
      a.sendRaw(updateFrame(new Uint8Array([0xff, 0xff, 0xff, 0x7f, 0, 0, 0]))); // framed, but not a valid Yjs update
      await a.waitUntil('the 1003 close', () => a.closes.length > 0);
      expect(a.lastClose?.code).toBe(1003);
      expect(await rowCount(boardId, 'updates')).toBe(rows);
      // The board is intact for the next person.
      const joiner = await newClient.connect(boardId);
      try {
        await joiner.waitUntil('the one note', () => joiner.notes().length === 1);
      } finally {
        await disconnectClients([joiner]);
      }
    } finally {
      await disconnectClients([a]);
    }
  });

  // TC-18: the hibernation API in anger — sockets accepted before an eviction wake
  // the room with their next frame and still receive the broadcast.
  it('TC-18 broadcasts to sockets accepted before an eviction', async () => {
    const boardId = newBoardId();
    const [a, b] = await connectClients(boardId, 2);
    try {
      initDoc(a.doc);
      await waitForConvergence([a, b]);
      expect(await socketCount(boardId)).toBe(2);
      await evict(boardId);

      createSticky(a.doc, { x: 12, y: 34 }); // the frame wakes the room, whose doc comes from storage
      await b.waitUntil('the note through hibernation', () => b.notes().length === 1);
      // `createSticky` centres on the point given, so the stored top-left is below it.
      expect(b.notes()[0]?.x).toBe(12 - STICKY_SIZE_WORLD / 2);
      expect(b.notes()).toEqual(a.notes());
      expect(await socketCount(boardId)).toBe(2); // the same two seats, woken
      await waitForConvergence([a, b]);
    } finally {
      await disconnectClients([a, b]);
    }
  }, 60_000);

  // TC-26: a load that dies on SQL says so honestly — `store.load` reports
  // `sql-error` (via the design's injected store), and the room answers new sockets
  // with 4500, never with an empty board (via damage that survives the eviction).
  it('TC-26 reports sql failures on load and refuses sockets with 4500', async () => {
    const boardId = await boardWithOneNote();
    await inRoom(boardId, (room) => {
      room.store.testBeforeExec = (query) => {
        if (query.startsWith('SELECT seq, data, bytes FROM updates')) {
          throw new Error('injected storage read failure');
        }
      };
    });
    const result = await inRoom(boardId, (room) => room.store.load(new Y.Doc()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sql-error');

    // The room side, through the same shape of failure held in real storage:
    await breakLogTable(boardId);
    await evict(boardId);
    expect(await inRoom(boardId, (room) => room.state)).toBe('load-failed');
    const client = await newClient.connect(boardId);
    try {
      await client.waitUntil('the 4500 close', () => client.closes.length > 0);
      expect(client.lastClose?.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    } finally {
      await disconnectClients([client]);
    }
  });
});
