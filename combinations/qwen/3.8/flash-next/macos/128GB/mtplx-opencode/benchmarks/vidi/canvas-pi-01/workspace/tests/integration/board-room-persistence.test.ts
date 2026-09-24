/**
 * Story 4 · persistent-room integration tests (TC-12 … TC-18, TC-26).
 *
 * These run inside workerd against the real `BoardRoom` Durable Object, real
 * WebSockets and real SQLite-backed DO storage (design "Mock vs real
 * boundaries"). Failures are injected through the `testHooks` seam in
 * `board-store.ts` (which sits outside SQLite), and damaged data is written
 * into the real tables with `runInDurableObject`.
 *
 * Two helpers do the heavy lifting:
 *  - `RoomClient` (tests/integration/helpers/room-client.ts) drives a
 *    client-side `Y.Doc` through the story 3 handshake, so a test can express
 *    "a client that reconnects still holding a change";
 *  - `evictDurableObject(stub, { webSockets: 'hibernate' })` forgets the
 *    object's memory while keeping its sockets — the local equivalent of the
 *    restart the PRD cares about.
 */
import { abortAllDurableObjects, env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import worker from '../../src/worker/index';
import { BoardStore, resetTestHooks, testHooks, type StorageLike } from '../../src/worker/board-store';
import { makeRetroDoc, randomBytesLike, truncatedUpdate } from '../fixtures/boards';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { RoomClient, updateFrame } from './helpers/room-client';

afterEach(async () => {
  resetTestHooks();
  abortAllDurableObjects();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** A 22-character room key (the Worker only routes well-formed board ids). */
function roomId(name: string): string {
  const id = name.padEnd(22, 'x').slice(0, 22);
  if (!/^[a-zA-Z0-9_-]{22}$/.test(id)) throw new Error(`bad room id ${id}`);
  return id;
}

function upgradeRequest(path: string): Request {
  return new Request(`http://inner${path}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
}

/** Open a client on a room through the real Worker routing path. */
async function openClient(name: string, doc?: Y.Doc): Promise<RoomClient> {
  const response = await worker.fetch(upgradeRequest(`/api/rooms/${roomId(name)}`), env);
  const socket = response.webSocket;
  if (socket === undefined || socket === null) {
    throw new Error(`no socket for ${name}: status ${response.status}`);
  }
  socket.accept();
  return new RoomClient(socket, doc);
}

function stubFor(name: string) {
  const ns = env.BOARD_ROOM;
  if (ns === undefined) throw new Error('BOARD_ROOM binding missing');
  return ns.get(ns.idFromName(roomId(name)));
}

/** Run `fn` with the room's real storage (creating the object if needed). */
function withStorage<T>(name: string, fn: (storage: StorageLike) => T): Promise<T> {
  return runInDurableObject(stubFor(name), (_instance, state) =>
    fn(state.storage as unknown as StorageLike),
  );
}

/** How many update rows the board's log holds. */
function logRows(name: string): Promise<number> {
  return withStorage(name, (storage) => {
    const row = storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one();
    return Number(row?.['c'] ?? 0);
  });
}

/**
 * Seed the board with the 25-note fixture as a two-chunk snapshot, so a test
 * can then damage it (TC-15 / TC-16).
 */
async function seedSnapshot(name: string): Promise<Uint8Array> {
  const { doc } = makeRetroDoc();
  const bytes = Y.encodeStateAsUpdate(doc);
  const half = Math.floor(bytes.byteLength / 2);
  await withStorage(name, (storage) => {
    new BoardStore(storage).migrate();
    storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, bytes.slice(0, half));
    storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 1, bytes.slice(half));
  });
  return bytes;
}

/** Forget the object's memory, keeping hibernated sockets (restart locally). */
function evict(name: string): Promise<void> {
  return evictDurableObject(stubFor(name), { webSockets: 'hibernate' });
}

describe('write before broadcast (TC-12)', () => {
  it('TC-12: a note B can see is already stored, and storage reloads into it', async () => {
    const a = await openClient('tc12');
    const b = await openClient('tc12');
    // Both greet each other with SyncStep1 before any traffic.
    expect(await a.waitForFrames(1)).toBe(true);
    expect(await b.waitForFrames(1)).toBe(true);

    a.push((doc) => {
      createSticky(doc, { x: 100, y: 100 }, 'blue');
    });

    // B sees the change…
    expect(await b.waitUntil(() => snapshot(b.doc).length === 1)).toBe(true);
    // …and by then the log row exists (the insert happened in the same turn,
    // before the broadcast — design decision 1).
    const rows = await logRows('tc12');
    expect(rows).toBe(1);

    // A doc rebuilt from the stored bytes contains the note (negative: it is
    // not only in memory).
    const reloaded = await withStorage('tc12', (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return { result, size: snapshot(fresh).length };
    });
    expect(reloaded.result.ok).toBe(true);
    expect(reloaded.size).toBe(1);
  });
});

describe('reopen after everyone leaves (TC-13)', () => {
  it('TC-13: a fresh room instance over the same storage serves the same board', async () => {
    const { doc: original } = makeRetroDoc();
    const expected = JSON.stringify(snapshot(original));

    // Phase "before": one client writes the whole board, then everybody leaves.
    const a = await openClient('tc13');
    await a.waitForFrames(1);
    // One frame holding the whole fixture (the 4,011 transactions of the board
    // are applied locally first, like a pasted board).
    const wholeBoard = Y.encodeStateAsUpdate(original);
    Y.applyUpdate(a.doc, wholeBoard);
    a.send(updateFrame(wholeBoard));
    expect(await a.waitUntil(() => snapshot(a.doc).length === 25)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await logRows('tc13')).toBe(1);
    a.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The object forgets its memory: this is the local stand-in for a restart.
    await evict('tc13');

    // Phase "after": a new client on a new instance reads the same board.
    const late = await openClient('tc13');
    expect(await late.waitUntil(() => snapshot(late.doc).length === 25, 15000)).toBe(true);
    expect(JSON.stringify(snapshot(late.doc))).toBe(expected);
  }, 30000);
});

describe('storage failure (TC-14)', () => {
  it('TC-14: a failed write is not broadcast, and a reconnect re-sends it', async () => {
    const a = await openClient('tc14');
    const b = await openClient('tc14');
    expect(await a.waitForFrames(1)).toBe(true);
    expect(await b.waitForFrames(1)).toBe(true);

    // Inject: the next SQL statement (the log insert) throws once.
    testHooks.failNextSql = 1;

    a.push((doc) => {
      createSticky(doc, { x: 0, y: 0 });
    });

    // Both sockets are closed with 1011 and the change is never broadcast.
    expect(await a.waitForClose()).toBe(true);
    expect(await b.waitForClose()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(a.closeCodes).toEqual([1011]);
    expect(b.closeCodes).toEqual([1011]);
    // Negative: B never sees the note (its only content frame is the empty
    // SyncStep2 that answers its own handshake) and nothing was written.
    expect(snapshot(b.doc).length).toBe(0);
    expect(snapshot(a.doc).length).toBe(1); // the client still holds its change

    resetTestHooks();

    // Recovery: the room discarded its doc when the write failed, so the next
    // connection reloads it. B comes back first, then A comes back *with* its
    // change, which then flows through the SyncStep2 exchange.
    const b2 = await openClient('tc14');
    await b2.waitForFrames(1);
    const a2 = await openClient('tc14', a.doc);
    expect(await b2.waitUntil(() => snapshot(b2.doc).length === 1, 15000)).toBe(true);
    expect(snapshot(b2.doc)[0]?.['text']).toBe('');
    expect(await logRows('tc14')).toBe(1);
  }, 30000);
});

describe('load failure (TC-15, TC-16, TC-26)', () => {
  it('TC-15: an unreadable snapshot closes with 4500 and stores nothing', async () => {
    await seedSnapshot('tc15');
    await withStorage('tc15', (storage) => {
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(4096, 0x99));
    });
    await evict('tc15');

    // A client that still holds content: its SyncStep2 must not be stored.
    const { doc } = makeRetroDoc();
    const client = await openClient('tc15', doc);

    expect(await client.waitForClose()).toBe(true);
    expect(client.closeCodes).toEqual([4500]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Negative: the room never became "an empty editable board" and stored
    // nothing (design: LoadFailed must not serve or store).
    expect(await logRows('tc15')).toBe(0);
  });

  it('TC-16: before the retry interval the room refuses without reloading; after it, it loads', async () => {
    // Seed a *valid* two-chunk snapshot, then damage chunk 0.
    const bytes = await seedSnapshot('tc16');
    const firstHalf = bytes.slice(0, Math.floor(bytes.byteLength / 2));
    await withStorage('tc16', (storage) => {
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(4096, 0x77));
    });
    await evict('tc16');

    // A short interval keeps the boundary real (the gate is exercised, not the
    // full 5 seconds) and the suite fast.
    resetTestHooks();
    testHooks.loadRetryMs = 400;

    // First open: the object wakes, tries to load, fails, closes 4500.
    const first = await openClient('tc16');
    expect(await first.waitForClose()).toBe(true);
    expect(first.closeCodes).toEqual([4500]);
    expect(testHooks.loadAttempts).toBe(1);

    // Immediately again, *before* the interval: refused, and no reload attempt
    // (that is what the interval is for).
    const second = await openClient('tc16');
    expect(await second.waitForClose()).toBe(true);
    expect(second.closeCodes).toEqual([4500]);
    expect(testHooks.loadAttempts).toBe(1);

    // Repair the snapshot and let the interval pass: the next open reloads.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await withStorage('tc16', (storage) => {
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', firstHalf);
    });

    const third = await openClient('tc16');
    expect(await third.waitUntil(() => snapshot(third.doc).length === 25, 15000)).toBe(true);
    expect(testHooks.loadAttempts).toBe(2);
    expect(third.closeCodes).toEqual([]);
  }, 30000);

  it('TC-26: a SQL error while reading the log closes clients with 4500', async () => {
    await seedSnapshot('tc26');
    // Break the *read* path for real: leave a table named `updates` without
    // the columns `load()` selects, so the replay query itself fails.
    await withStorage('tc26', (storage) => {
      storage.sql.exec('DROP TABLE updates');
      storage.sql.exec('CREATE TABLE updates (seq INTEGER PRIMARY KEY, junk TEXT NOT NULL)');
    });
    await evict('tc26');

    const client = await openClient('tc26');
    expect(await client.waitForClose()).toBe(true);
    expect(client.closeCodes).toEqual([4500]);
  });
});

describe('rejected input (TC-17)', () => {
  it('TC-17: garbage is refused with 1003 and never stored', async () => {
    const client = await openClient('tc17');
    expect(await client.waitForFrames(1)).toBe(true);

    // Truncated but plausible-looking update bytes: Yjs rejects them.
    const { doc } = makeRetroDoc();
    const garbage = truncatedUpdate(Y.encodeStateAsUpdate(doc), 10);
    expect(() => Y.applyUpdate(new Y.Doc(), garbage)).toThrow();

    client.send(updateFrame(garbage));

    expect(await client.waitForClose()).toBe(true);
    expect(client.closeCodes).toEqual([1003]);
    // Negative: nothing was written, not even the junk frame's bytes.
    expect(await logRows('tc17')).toBe(0);
  });
});

describe('hibernation (TC-18)', () => {
  it('TC-18: after the object is rebuilt, a change still reaches the sockets accepted before it', async () => {
    const a = await openClient('tc18');
    const b = await openClient('tc18');
    expect(await a.waitForFrames(1)).toBe(true);
    expect(await b.waitForFrames(1)).toBe(true);

    // Forget memory, keep the (hibernated) sockets.
    await evict('tc18');

    // A wakes the object with a change; B must still receive it, which is only
    // possible if the broadcast iterates `ctx.getWebSockets()`.
    a.push((doc) => {
      createSticky(doc, { x: 10, y: 10 });
    });

    expect(await b.waitUntil(() => snapshot(b.doc).length === 1, 10000)).toBe(true);
    expect(b.closeCodes).toEqual([]);
    expect(await logRows('tc18')).toBe(1);
  }, 30000);
});
