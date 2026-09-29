/**
 * Integration tests for the persistent, hibernating {@link BoardRoom} (`persist.room`,
 * TC-12 to TC-18, TC-26). These drive the room the way the browser does — through
 * `RoomClient` (a real `Y.Doc` over a `SELF.fetch` WebSocket) — and inspect the SAME
 * board's SQLite storage through `runInDurableObject` over the same Durable Object id,
 * so the `storage` the live room writes is exactly what the test reads back. Nothing
 * about sync, broadcast, close codes, or the write-before-broadcast ordering is mocked.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, runInDurableObject } from 'cloudflare:test';
import { RoomClient, sameSnapshot, sleep } from './helpers/ws-client.js';
import { BoardStore } from '../../src/worker/board-store.js';
import type { BoardRoom } from '../../src/worker/board-room.js';
import { newBoardId } from '../../src/shared/board-id.js';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model.js';
import {
  MESSAGE_SYNC,
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol.js';
import { COMPACTION_UPDATE_COUNT } from '../../src/shared/config.js';
import { retro25Board, retro25BoardWithRows } from '../fixtures/boards.js';

const stubFor = (boardId: string): DurableObjectStub<BoardRoom> =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/** A sync-update frame carrying a garbage update body the room must reject on apply. */
const garbageUpdateFrame = (): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  return encoding.toUint8Array(encoder);
};

interface StorageRead {
  ok: boolean;
  reason?: string;
  notes: readonly StickySnapshot[];
  rows: number;
  chunks: number;
}

/** Load the board's CURRENT storage into a throwaway doc (the reopen-after-eviction path). */
const readStorage = (boardId: string): Promise<StorageRead> =>
  runInDurableObject(stubFor(boardId), (_inst, state) => {
    const store = new BoardStore(state.storage);
    const doc = new Y.Doc();
    const result = store.load(doc);
    return {
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      notes: snapshot(doc),
      rows: store.logRowCount(),
      chunks: store.snapshotChunkCount(),
    };
  });

describe('BoardRoom durability (TC-12, TC-13, TC-18)', () => {
  it('TC-12 an update is in storage before B observes it, and reloads from storage', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();
    const b = await RoomClient.connect(boardId);
    await b.waitForHandshake();

    const id = a.createSticky(300, 240, 'green');
    await b.until(() => b.snapshot().some((n) => n.id === id), 3000, 'B sees note');
    const expected = a.snapshot().find((n) => n.id === id)!;

    // Write-before-broadcast: by the time B has seen the change, the row is durable.
    const during = await readStorage(boardId);
    expect(during.rows).toBeGreaterThanOrEqual(1);

    a.close();
    b.close();

    const after = await readStorage(boardId);
    const fresh = after.notes.find((n) => n.id === id);
    expect(fresh).toEqual(expected);
  });

  it('TC-13 reopen after everyone leaves: a fresh load over the same storage equals the board', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();
    for (let i = 0; i < 25; i++) a.createSticky(i * 10, i * 8, 'pink');
    await a.until(() => a.snapshot().length >= 25, 3000, 'client has 25 notes');
    // Wait until the ROOM has durably stored all 25 (each frame is appended synchronously
    // as it is processed), so closing cannot race an in-flight change.
    let reopened = await readStorage(boardId);
    for (let i = 0; i < 200 && reopened.notes.length < 25; i++) {
      await sleep(10);
      reopened = await readStorage(boardId);
    }
    const expected = a.snapshot();
    a.close();
    await a.waitForClose();

    // A fresh doc loaded from the same storage equals what the room last held.
    reopened = await readStorage(boardId);
    expect(reopened.ok).toBe(true);
    expect(sameSnapshot(reopened.notes, expected)).toBe(true);
  });

  it('TC-18 broadcast reaches a socket accepted before later activity via ctx.getWebSockets', async () => {
    const boardId = newBoardId();
    // B is accepted FIRST then idles; A connects later and changes the board. The broadcast
    // iterates ctx.getWebSockets() (not a stale set), so the earlier-accepted socket receives.
    const b = await RoomClient.connect(boardId);
    await b.waitForHandshake();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();

    const id = a.createSticky(80, 120, 'blue');
    await b.until(() => b.snapshot().some((n) => n.id === id), 3000, 'earlier socket receives');
    expect(b.updatesReceived).toBeGreaterThanOrEqual(1);

    a.close();
    b.close();
  });
});

describe('BoardRoom storage failure (TC-14)', () => {
  it('TC-14 one append failure closes both sockets 1011 without broadcasting; reconnect stores it', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();
    const b = await RoomClient.connect(boardId);
    await b.waitForHandshake();

    // Wrap the live instance's store so its NEXT append throws once, then defers to real.
    await runInDurableObject(stubFor(boardId), (inst) => {
      const store = (inst as unknown as { store: BoardStore }).store;
      const original = store.append.bind(store);
      let thrown = false;
      store.append = (update: Uint8Array): void => {
        if (!thrown) {
          thrown = true;
          throw new Error('injected append failure');
        }
        original(update);
      };
    });

    // A's change cannot be stored: the room must NOT broadcast it and closes everyone 1011.
    a.createSticky(10, 10, 'yellow');
    expect(await a.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);
    expect(await b.waitForClose()).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot().length).toBe(0); // the unsaved change never reached B

    // A reconnects, still holding its change; the reload stores it and a fresh B receives it.
    const a2 = await RoomClient.connectWithDoc(boardId, a.doc);
    await a2.waitForHandshake();
    const b2 = await RoomClient.connect(boardId);
    await b2.waitForHandshake();
    await b2.until(() => b2.snapshot().length >= 1, 3000, 'B2 receives recovered note');

    const stored = await readStorage(boardId);
    expect(stored.notes.length).toBe(1);
    a2.close();
    b2.close();
  });
});

describe('BoardRoom load failure (TC-15, TC-16, TC-26)', () => {
  /** Seed a compacted snapshot, corrupt chunk 0, and force the room's own load() to fail. */
  const corruptSnapshotAndReload = (boardId: string, updates: readonly Uint8Array[]): Promise<void> =>
    runInDurableObject(stubFor(boardId), (inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const live = new Y.Doc();
      for (const u of updates) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      store.compactIfNeeded(live);
      const original = new Uint8Array(
        state.storage.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .one().data,
      );
      const broken = new Uint8Array(original.length);
      let seed = 99;
      for (let i = 0; i < broken.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        broken[i] = (seed >>> 16) & 0xff;
      }
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        broken.buffer.slice(0),
      );
      // Force the room to read the damaged storage through its own load(): it must land in
      // `load-failed` exactly as a real restart against damaged storage would.
      (inst as unknown as { load(): void }).load();
    });

  it('TC-15 a damaged snapshot closes the client with 4500 and stores nothing', async () => {
    const boardId = newBoardId();
    const board = retro25BoardWithRows(COMPACTION_UPDATE_COUNT);
    await corruptSnapshotAndReload(boardId, board.updates);

    const before = await readStorage(boardId);
    expect(before.chunks).toBeGreaterThanOrEqual(1);

    const client = await RoomClient.connect(boardId);
    expect(await client.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);

    // The LoadFailed room neither serves an empty doc nor stores the newcomer's frames.
    const after = await readStorage(boardId);
    expect(after.rows).toBe(before.rows);
  });

  it('TC-16 reload is retried only after LOAD_RETRY_MIN_INTERVAL_MS; a repair then loads', async () => {
    const boardId = newBoardId();
    const board = retro25BoardWithRows(COMPACTION_UPDATE_COUNT);
    const original = snapshot(board.doc);

    // Corrupt chunk 0, but stash the good bytes so the repair step can restore them.
    await runInDurableObject(stubFor(boardId), (inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const live = new Y.Doc();
      for (const u of board.updates) {
        store.append(u);
        Y.applyUpdate(live, u);
      }
      store.compactIfNeeded(live);
      const good = new Uint8Array(
        state.storage.sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .one().data,
      );
      const broken = new Uint8Array(good.length);
      let seed = 7;
      for (let i = 0; i < broken.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        broken[i] = (seed >>> 16) & 0xff;
      }
      state.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        '__good_chunk0',
        Buffer.from(good).toString('base64'),
      );
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        broken.buffer.slice(0),
      );
      (inst as unknown as { load(): void }).load();
    });

    // Before the interval elapses: closed 4500 with no reload attempt (log rows unchanged).
    const before = await readStorage(boardId);
    const early = await RoomClient.connect(boardId);
    expect(await early.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect((await readStorage(boardId)).rows).toBe(before.rows);

    // Repair storage, then rewind the failure stamp so the retry interval has "elapsed"
    // without the test literally waiting LOAD_RETRY_MIN_INTERVAL_MS of wall clock.
    await runInDurableObject(stubFor(boardId), (inst, state) => {
      const value = state.storage.sql
        .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', '__good_chunk0')
        .one().value;
      const bytes = new Uint8Array(Buffer.from(value, 'base64'));
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
        bytes.buffer.slice(0),
      );
      (inst as unknown as { loadFailedAt: number }).loadFailedAt = 0;
    });

    // After the interval, the next connection reloads and syncs the whole board.
    const client = await RoomClient.connect(boardId);
    await client.waitForHandshake();
    await client.until(() => sameSnapshot(client.snapshot(), original), 3000, 'repaired board loads');
    client.close();
  });

  it('TC-26 an SQL read error during load closes clients with 4500', async () => {
    const boardId = newBoardId();
    // Seed durable rows so the failure is a read failure, not merely an empty board.
    const board = retro25Board();
    await runInDurableObject(stubFor(boardId), (_inst, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const u of board.updates) store.append(u);
    });

    // Swap in a store whose load hits a real SQL read error, then run the room's own load().
    await runInDurableObject(stubFor(boardId), (inst, state) => {
      const failing = {
        migrate: (): void => undefined,
        load: (): { ok: boolean } => {
          state.storage.sql.exec('SELECT data FROM no_such_table_for_test');
          return { ok: true };
        },
      };
      const room = inst as unknown as { store: unknown; load(): void };
      room.store = failing;
      room.load();
    });

    const client = await RoomClient.connect(boardId);
    expect(await client.waitForClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});

describe('BoardRoom rejects garbage without storing (TC-17)', () => {
  it('TC-17 a garbage update closes the socket 1003 and stores no log row', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();

    const before = await readStorage(boardId);
    // A properly framed sync-update whose body Yjs rejects on apply.
    a.sendRaw(garbageUpdateFrame());
    expect(await a.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);

    // A rejected update fires no `update` event, so nothing is written to the log.
    const after = await readStorage(boardId);
    expect(after.rows).toBe(before.rows);
  });
});
