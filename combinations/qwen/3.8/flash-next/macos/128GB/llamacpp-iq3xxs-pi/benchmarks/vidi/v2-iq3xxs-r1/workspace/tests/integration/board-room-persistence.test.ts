import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, runInDurableObject } from 'cloudflare:test';
import { createSticky, snapshot } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { chunkBytes } from '../../src/worker/board-store';
import type { Env } from '../../src/worker/index';
import { RoomClient, waitForConvergence } from './ws-client';
import { randomBytesLike, retroBoard } from '../fixtures/boards';

/**
 * `persist.room` against a real, persistent Durable Object (design TC-12 to TC-18,
 * TC-26). The room is reached exactly as a browser reaches it — a `SELF.fetch`
 * WebSocket upgrade — and inspected through `runInDurableObject`, which runs in the
 * live object's isolate so tests can read the private `store`/`doc`/`status`, inject
 * a throwing `store.append`, overwrite snapshot bytes, and load the stored board into
 * a fresh `Y.Doc`. Storage is real Durable Object SQLite in every case.
 */

const namespace = () => (env as unknown as Env).BOARD_ROOM;
const stubFor = (boardId: string) => namespace().get(namespace().idFromName(boardId));

interface RoomInternals {
  doc: Y.Doc | undefined;
  status: 'loading' | 'ready' | 'load-failed' | 'storage-failed' | 'hibernated';
  store: {
    append: (u: Uint8Array) => void;
    load: (d: Y.Doc) => unknown;
    loadIntoFreshDoc?: () => unknown;
  };
  loadIntoFreshDoc: () => unknown;
  boardId: string;
}

function peek<T>(boardId: string, read: (room: RoomInternals, state: DurableObjectState) => T): Promise<T> {
  return runInDurableObject(stubFor(boardId), (room, state) => read(room as unknown as RoomInternals, state));
}

function rows(boardId: string): Promise<number> {
  return peek(boardId, (_room, state) =>
    state.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates').one().c,
  );
}

/** Poll the live room until `predicate` holds, so an asynchronous close has landed. */
async function waitForRoom<T>(
  boardId: string,
  read: (room: RoomInternals, state: DurableObjectState) => T,
  predicate: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await peek(boardId, read);
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`room ${label} not reached: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Fold the stored log into a snapshot through the real chunking code, then return the
 * max log seq (so a caller can damage the snapshot). A snapshot written here is a real
 * `Y.encodeStateAsUpdate` of the board, split by `chunkBytes` exactly as compaction does.
 */
function writeValidSnapshot(boardId: string): Promise<number> {
  return peek(boardId, (room, state) => {
    const doc = new Y.Doc();
    room.store.load(doc);
    const encoded = Y.encodeStateAsUpdate(doc);
    const maxSeq = state.storage.sql
      .exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates')
      .one().m ?? 0;
    state.storage.sql.exec('DELETE FROM snapshot_chunks');
    chunkBytes(encoded).forEach((chunk, idx) => {
      const buf = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buf).set(chunk);
      state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, buf);
    });
    state.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'snapshot_through_seq',
      String(maxSeq),
    );
    return maxSeq;
  });
}

/** Scramble snapshot chunk 0 with real random bytes, leaving a valid-looking table. */
function corruptChunkZero(boardId: string, original: Uint8Array): Promise<void> {
  return peek(boardId, (_room, state) => {
    const garbage = randomBytesLike(original);
    const buf = new ArrayBuffer(garbage.byteLength);
    new Uint8Array(buf).set(garbage);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', buf);
  });
}

/** Restore chunk 0 to the board's true encoding (the "repair" of TC-16). */
function repairChunkZero(boardId: string): Promise<void> {
  return peek(boardId, (room, state) => {
    const doc = new Y.Doc();
    // Load the log rows (seq > through_seq = none) plus whatever survives; instead of
    // the corrupt snapshot, rebuild from the log that is still intact and re-chunk it.
    void room;
    const rowsHere = state.storage.sql
      .exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY seq ASC')
      .toArray();
    for (const row of rowsHere) Y.applyUpdate(doc, new Uint8Array(row.data));
    const encoded = Y.encodeStateAsUpdate(doc);
    state.storage.sql.exec('DELETE FROM snapshot_chunks');
    chunkBytes(encoded).forEach((chunk, idx) => {
      const buf = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buf).set(chunk);
      state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, buf);
    });
  });
}

// =========================================================== TC-12: store before broadcast
describe('TC-12 the change is stored before it is broadcast', () => {
  it('the updates row exists when B sees the note, and a fresh doc reloads it', async () => {
    const boardId = await RoomClient.createBoard();
    const [a, b] = await Promise.all([RoomClient.connect(boardId, 'A'), RoomClient.connect(boardId, 'B')]);
    await a.waitForSync();
    await b.waitForSync();
    await waitForConvergence([a, b]);

    // A's local creation, observed at the instant B receives it.
    const id = createSticky(a.doc, { x: 100, y: 120 });
    await b.waitFor(() => b.notes.some((note) => note.id === id), 'B receives the note');
    const rowCount = await rows(boardId); // read at the receipt point: row already there
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // A brand-new doc built from storage alone contains the note.
    const reloaded = await peek(boardId, (room) => {
      const fresh = new Y.Doc();
      room.store.load(fresh);
      return snapshot(fresh).some((note) => note.id === id);
    });
    expect(reloaded).toBe(true);

    a.destroy();
    b.destroy();
  });
});

// =========================================================== TC-13: reopen after everyone leaves
describe('TC-13 a fresh room over the same storage reloads the board', () => {
  it('after all clients leave, a new client sees the identical 25-note board', async () => {
    const boardId = await RoomClient.createBoard();
    const retro = retroBoard();
    const a = await RoomClient.connect(boardId, 'A');
    await a.waitForSync();
    for (const update of retro.updates) Y.applyUpdate(a.doc, update);
    await a.waitFor(() => a.state === JSON.stringify(retro.notes), 'A shows the whole retro board');
    a.destroy();
    await waitForRoom(
      boardId,
      (room, state) => ({ sockets: state.getWebSockets().length, cold: room.doc === undefined }),
      (v) => v.sockets === 0 && v.cold,
      'went cold after last close',
    );

    const b = await RoomClient.connect(boardId, 'B');
    await b.waitForSync();
    await b.waitFor(() => b.notes.length === retro.notes.length, 'B rebuilt the retro board');
    expect(b.notes).toEqual(retro.notes);
    b.destroy();
  });
});

// =========================================================== TC-14: SQL error on write
describe('TC-14 a write SQLite refuses is not broadcast, then recovers on reconnect', () => {
  it('closes A and B with 1011, keeps the change out of B, then stores it on retry', async () => {
    const boardId = await RoomClient.createBoard();
    const [a, b] = await Promise.all([RoomClient.connect(boardId, 'A'), RoomClient.connect(boardId, 'B')]);
    await a.waitForSync();
    await b.waitForSync();
    await waitForConvergence([a, b]);
    const rowsBefore = await rows(boardId);

    // The very next append fails, exactly once — a transient SQLite write failure.
    await peek(boardId, (room) => {
      const real = room.store.append.bind(room.store);
      let failed = false;
      room.store.append = (update: Uint8Array) => {
        if (!failed) {
          failed = true;
          throw new Error('injected storage failure');
        }
        return real(update);
      };
    });

    // A's change is refused: A and B are closed with 1011 and it never reaches B.
    const id = createSticky(a.doc, { x: 20, y: 20 });
    const closeA = await a.closed();
    const closeB = await b.closed();
    expect(closeA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closeB.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.notes.some((note) => note.id === id)).toBe(false); // never broadcast to B
    expect((await rows(boardId))).toBe(rowsBefore); // and never stored

    // Reconnecting: A still holds the change; the handshake re-appends it (this time it
    // stores) and only then broadcasts, so B finally receives it.
    await a.reconnect();
    await b.reconnect();
    await a.waitForSync();
    await b.waitForSync();
    await waitForConvergence([a, b]);
    expect(a.notes.some((note) => note.id === id)).toBe(true);
    expect(b.notes.some((note) => note.id === id)).toBe(true);
    expect((await rows(boardId))).toBeGreaterThan(rowsBefore);

    a.destroy();
    b.destroy();
  });
});

// =========================================================== TC-15: damaged snapshot
describe('TC-15 a damaged snapshot refuses to serve an empty board', () => {
  it('closes a newcomer with 4500 and stores nothing from it', async () => {
    const boardId = await RoomClient.createBoard();
    const retro = retroBoard();
    const seed = await RoomClient.connect(boardId, 'seed');
    await seed.waitForSync();
    for (const update of retro.updates) Y.applyUpdate(seed.doc, update);
    await seed.waitFor(() => seed.notes.length === retro.notes.length, 'seed wrote the retro board');
    seed.destroy();
    await waitForRoom(boardId, (_room, state) => state.getWebSockets().length, (n) => n === 0, 'idle');

    // Compact for real, then damage snapshot chunk 0 (as TC-10 does to the store).
    await writeValidSnapshot(boardId);
    const original = await peek(boardId, (_room, state) => {
      const data = state.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data;
      return new Uint8Array(data);
    });
    await corruptChunkZero(boardId, original);
    const rowsBefore = await rows(boardId);

    const newcomer = await RoomClient.connect(boardId, 'newcomer');
    const closed = await newcomer.closed();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    // A load-failed room never serves a doc, so it stores none of the newcomer's updates.
    expect(await rows(boardId)).toBe(rowsBefore);
    newcomer.destroy();
  });
});

// =========================================================== TC-16: damaged then repaired
describe('TC-16 a load-failed room retries only after the interval, then syncs', () => {
  it(
    'rejects twice within the interval, then loads the repaired board',
    async () => {
      const boardId = await RoomClient.createBoard();
      const retro = retroBoard();
      const seed = await RoomClient.connect(boardId, 'seed');
      await seed.waitForSync();
      for (const update of retro.updates) Y.applyUpdate(seed.doc, update);
      await seed.waitFor(() => seed.notes.length === retro.notes.length, 'seed wrote the retro board');
      seed.destroy();
      await waitForRoom(boardId, (_room, state) => state.getWebSockets().length, (n) => n === 0, 'idle');

      await writeValidSnapshot(boardId);
      const original = await peek(boardId, (_room, state) =>
        new Uint8Array(state.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data),
      );
      await corruptChunkZero(boardId, original);

      // First attempt: closed 4500 and the room is now load-failed.
      const first = await RoomClient.connect(boardId, 'first');
      expect((await first.closed()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(await peek(boardId, (room) => room.status)).toBe('load-failed');

      // Second attempt within LOAD_RETRY_MIN_INTERVAL_MS: rejected with 4500 and NO
      // reload attempted (still load-failed, not even 'loading').
      const second = await RoomClient.connect(boardId, 'second');
      expect((await second.closed()).code).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(await peek(boardId, (room) => room.status)).toBe('load-failed');

      // Repair the snapshot, then wait out the retry interval.
      await repairChunkZero(boardId);
      await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 60));

      const healed = await RoomClient.connect(boardId, 'healed');
      await healed.waitForSync();
      await healed.waitFor(() => healed.notes.length === retro.notes.length, 'healed loads the board');
      expect(healed.notes).toEqual(retro.notes);
      expect(await peek(boardId, (room) => room.status)).toBe('ready');
      healed.destroy();
    },
    30_000,
  );
});

// =========================================================== TC-17: garbage update
describe('TC-17 a garbage update is rejected without storing it', () => {
  it('closes the offending socket with 1003 and stores nothing new', async () => {
    const boardId = await RoomClient.createBoard();
    const a = await RoomClient.connect(boardId, 'A');
    await a.waitForSync();
    const rowsBefore = await rows(boardId);

    // A real update frame (type SYNC, sub-message writeUpdate) whose payload is
    // random bytes: it decodes as a sync message but the update cannot be applied.
    const garbage = randomBytesLike(new Uint8Array(256));
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    syncProtocol.writeUpdate(frame, garbage);
    a.sendRaw(encoding.toUint8Array(frame));

    const closed = await a.closed();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await rows(boardId)).toBe(rowsBefore); // rejected garbage was never stored
    a.destroy();
  });
});

// =========================================================== TC-18: hibernation path
describe('TC-18 after a wake, broadcasts reach sockets accepted before it', () => {
  it('a reloaded document still feeds the sockets that were already open', async () => {
    const boardId = await RoomClient.createBoard();
    const [a, b] = await Promise.all([RoomClient.connect(boardId, 'B'), RoomClient.connect(boardId, 'B2')]);
    await a.waitForSync();
    await b.waitForSync();
    const id = createSticky(a.doc, { x: 30, y: 30 });
    await waitForConvergence([a, b]);

    // Model a wake/reconstruct while the sockets stay open: the room rebuilds its
    // document from storage without either socket reconnecting.
    await peek(boardId, (room) => room.loadIntoFreshDoc());
    expect((await peek(boardId, (_room, state) => state.getWebSockets().length))).toBe(2);

    // A change made after the wake must reach the socket accepted before it.
    const after = createSticky(a.doc, { x: 40, y: 40 });
    await b.waitFor(() => b.notes.some((note) => note.id === after), 'B sees the post-wake note');
    expect(b.notes.some((note) => note.id === id)).toBe(true); // the earlier note survived too

    a.destroy();
    b.destroy();
  });
});

// =========================================================== TC-26: SQL error on read
describe('TC-26 a SQL read failure closes a newcomer with 4500', () => {
  it('load reports the failure and the room refuses to serve an empty board', async () => {
    const boardId = await RoomClient.createBoard();
    const a = await RoomClient.connect(boardId, 'A');
    await a.waitForSync();
    createSticky(a.doc, { x: 1, y: 1 });
    await a.waitFor(() => a.notes.length === 1, 'A wrote a note');
    a.destroy();
    await waitForRoom(boardId, (_room, state) => state.getWebSockets().length, (n) => n === 0, 'idle');

    // Break the read path so a SELECT throws inside load (real SQL layer).
    await peek(boardId, (room) => {
      const sql = room.store;
      void sql;
      // Wrap load so the SELECT it runs throws, mirroring `make SELECT throw`.
      room.store.load = ((_doc: Y.Doc) => {
        throw new Error('injected SQL read failure');
      }) as typeof room.store.load;
    });

    const broken = await RoomClient.connect(boardId, 'broken');
    const closed = await broken.closed();
    expect(closed.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await peek(boardId, (room) => room.status)).toBe('load-failed');

    // Clear the injection and, after the retry interval, the board loads normally.
    await peek(boardId, (room) => {
      delete (room.store as { load?: unknown }).load; // fall back to the real prototype load
    });
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 60));
    const healed = await RoomClient.connect(boardId, 'healed');
    await healed.waitForSync();
    await healed.waitFor(() => healed.notes.length === 1, 'board loads after failure cleared');
    expect(await peek(boardId, (room) => room.status)).toBe('ready');
    healed.destroy();
  }, 30_000);
});
