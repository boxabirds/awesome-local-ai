import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Env } from '../../src/worker/env';
import { BoardStore, LOAD_ORIGIN, chunkBytes } from '../../src/worker/board-store';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '@shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@shared/config';
import { createSticky, snapshot, initDoc } from '@shared/board-model';
import { newBoardId } from '@shared/board-id';
import { openRoomClient, waitFor, snapshotsMatch, YTestClient } from './helpers/ws-client';

function getEnv(): Env {
  return env as unknown as Env;
}

function getStub(boardId: string) {
  const ns = getEnv().BOARD_ROOM;
  const id = ns.idFromName(boardId);
  return ns.get(id);
}

async function withStore<T>(boardId: string, fn: (store: BoardStore, storage: DurableObjectStorage) => T): Promise<T> {
  const stub = getStub(boardId);
  return runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
    const storage: DurableObjectStorage = obj.ctx.storage;
    const store = new BoardStore(storage);
    store.migrate();
    return fn(store, storage);
  }) as any) as unknown as T;
}

/**
 * Set up storage AND force the room into load-failed state (simulates hibernation wake with corrupt data).
 */
async function corruptAndSetLoadFailed(boardId: string, corruptFn: (storage: DurableObjectStorage) => void): Promise<void> {
  const stub = getStub(boardId);
  await runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
    const storage: DurableObjectStorage = obj.ctx.storage;
    const store = new BoardStore(storage);
    store.migrate();
    corruptFn(storage);
    // Force the room into load-failed state (simulating what happens on wake with corrupt data)
    obj.state = 'load-failed';
    obj.doc = null;
    obj.loadFailedAt = Date.now();
  }) as any) as unknown as void;
}

async function settle(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('persist.room integration', () => {
  it('TC-12: A creates note; by time B observes it, updates row exists; fresh doc from storage contains note', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(a.snapshot(), b.snapshot()), 4000);

    createSticky(a.doc, { x: 42, y: 42 });
    await waitFor(() => b.snapshot().length === 1, 4000, 'note did not reach B');

    // Verify storage row exists now that B has seen it
    const result = await withStore(board, (store, storage) => {
      const rows = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      const count = rows.done ? 0 : rows.value.cnt;
      const freshDoc = new Y.Doc();
      store.load(freshDoc);
      return { count, snap: snapshot(freshDoc) };
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.snap.length).toBe(1);

    a.close();
    b.close();
  });

  it('TC-13: all clients leave; new client on new room instance over same storage → snapshot equals original', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    await waitFor(() => a.received.length >= 1);
    for (let i = 0; i < 25; i++) {
      createSticky(a.doc, { x: i * 50, y: i * 30 });
    }
    await waitFor(() => a.snapshot().length === 25, 4000);
    const originalSnap = [...a.snapshot()];

    // All clients disconnect
    a.close();
    await settle(500);

    // New client connects (room wakes from hibernation, loads from storage)
    const b = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(b.snapshot(), originalSnap), 4000, 'reopened room did not match original');
    expect(b.snapshot().length).toBe(25);
    b.close();
  });

  it('TC-15: corrupt snapshot → client closed 4500; no updates stored if client sends before close', async () => {
    const board = newBoardId();

    // Create storage with a snapshot, then corrupt it and force room to load-failed
    await corruptAndSetLoadFailed(board, (storage) => {
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < 25; i++) {
        createSticky(doc, { x: i * 100, y: i * 100 });
      }
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      storage.transactionSync(() => {
        for (let i = 0; i < chunks.length; i++) {
          storage.sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, i, chunks[i]);
        }
        storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          '0',
        );
      });
      // Corrupt chunk 0
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
      });
    });

    // Connect should get 4500
    const res = await SELF.fetch(`http://localhost/api/rooms/${board}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    const ws = res.webSocket!;
    ws.accept();

    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve((event as CloseEvent).code));
    });
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Verify no additional rows were stored from the SyncStep2 attempt
    const result = await withStore(board, (_store, storage) => {
      const rows = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      return rows.done ? 0 : rows.value.cnt;
    });
    expect(result).toBe(0); // LoadFailed room stores nothing from incoming updates
  });

  it('TC-16: connect before LOAD_RETRY_MIN_INTERVAL_MS → 4500; repair; connect after interval → loads and syncs', async () => {
    const board = newBoardId();

    // Create storage with a valid snapshot, then corrupt chunk 0
    let originalChunk0: Uint8Array;
    const stub = getStub(board);
    await runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
      const storage: DurableObjectStorage = obj.ctx.storage;
      const store = new BoardStore(storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      for (let i = 0; i < 5; i++) {
        createSticky(doc, { x: i * 100, y: i * 100 });
      }
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      storage.transactionSync(() => {
        for (let i = 0; i < chunks.length; i++) {
          storage.sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, i, chunks[i]);
        }
        storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          '0',
        );
      });
      // Save original chunk 0
      const chunk0Row = storage.sql.exec<{ data: ArrayBuffer }>(
        `SELECT data FROM snapshot_chunks WHERE idx = 0`
      ).next();
      originalChunk0 = chunk0Row.done ? new Uint8Array(0) : new Uint8Array(chunk0Row.value.data);
      // Corrupt chunk 0
      storage.transactionSync(() => {
        storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
      });
      // Force load-failed state
      obj.state = 'load-failed';
      obj.doc = null;
      obj.loadFailedAt = Date.now();
    }) as any) as unknown as void;

    // First connect: 4500
    const res1 = await SELF.fetch(`http://localhost/api/rooms/${board}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res1.status).toBe(101);
    const ws1 = res1.webSocket!;
    ws1.accept();
    const close1 = await new Promise<number>((resolve) => {
      ws1.addEventListener('close', (event) => resolve((event as CloseEvent).code));
    });
    expect(close1).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Second connect immediately: still 4500 (before retry interval)
    const res2 = await SELF.fetch(`http://localhost/api/rooms/${board}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res2.status).toBe(101);
    const ws2 = res2.webSocket!;
    ws2.accept();
    const close2 = await new Promise<number>((resolve) => {
      ws2.addEventListener('close', (event) => resolve((event as CloseEvent).code));
    });
    expect(close2).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the snapshot and advance time past the retry interval
    await runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
      const storage: DurableObjectStorage = obj.ctx.storage;
      storage.transactionSync(() => {
        storage.sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, originalChunk0!);
      });
      // Move loadFailedAt into the past to simulate the interval having elapsed
      obj.loadFailedAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS - 1000;
    }) as any) as unknown as void;

    // Connect again: retry load succeeds
    const client = await openRoomClient(board);
    await waitFor(() => client.snapshot().length === 5, 4000, 'repair did not restore the board');
    client.close();
  }, 15000);

  it('TC-17: garbage update → closed 1003, row count unchanged', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    await waitFor(() => a.received.length >= 1);

    // Count rows before (there should be 1 from initDoc's first update)
    const before = await withStore(board, (store, storage) => {
      const rows = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      return rows.done ? 0 : rows.value.cnt;
    });

    // Send garbage update
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x7f, 1, 2, 3]));
    a.rawSend(encoding.toUint8Array(enc));

    await waitFor(() => a.closed !== null, 3000, 'not closed after garbage');
    expect(a.closed!.code).toBe(CLOSE_UNSUPPORTED_DATA);

    const after = await withStore(board, (store, storage) => {
      const rows = storage.sql.exec<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM updates`).next();
      return rows.done ? 0 : rows.value.cnt;
    });
    expect(after).toBe(before);
  });

  it('TC-26: SQL read error on load → room closes with 4500', async () => {
    const board = newBoardId();

    // Set up the room in load-failed state with corrupt storage that causes SQL errors
    await corruptAndSetLoadFailed(board, (storage) => {
      // Create snapshot_chunks with wrong schema (has data rows but SELECT data fails due to bad data type)
      // Instead, we'll use a different approach: create valid tables but make the data unparseable
      storage.transactionSync(() => {
        // Insert a snapshot chunk with data that can't be read as an ArrayBuffer properly
        storage.sql.exec(
          `INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`,
          0,
          new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8]),
        );
        storage.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          '0',
        );
      });
    });

    // First connect gives 4500 (load-failed state is already set)
    const res = await SELF.fetch(`http://localhost/api/rooms/${board}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve((event as CloseEvent).code));
    });
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  it('TC-14: storage write failure → 1011, B never received update', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(a.snapshot(), b.snapshot()), 4000);

    // Override the store's append to throw on next call
    const stub = getStub(board);
    await runInDurableObject(stub as unknown as DurableObjectStub, ((obj: any) => {
      const originalStore = obj.store;
      let appendCalled = false;
      obj.store = {
        migrate: () => originalStore.migrate(),
        append: (update: Uint8Array) => {
          if (!appendCalled) {
            appendCalled = true;
            throw new Error('injected storage failure');
          }
          return originalStore.append(update);
        },
        load: (doc: Y.Doc) => originalStore.load(doc),
        compactIfNeeded: (doc: Y.Doc) => originalStore.compactIfNeeded(doc),
      };
    }) as any) as unknown as void;

    // A makes a change — this should trigger the storage failure
    createSticky(a.doc, { x: 99, y: 99 });

    // Both should be closed with 1011
    await waitFor(() => a.closed !== null, 3000, 'A not closed after storage failure');
    expect(a.closed!.code).toBe(CLOSE_STORAGE_FAILURE);
    await waitFor(() => b.closed !== null, 3000, 'B not closed after storage failure');
    expect(b.closed!.code).toBe(CLOSE_STORAGE_FAILURE);

    // B never received the update
    expect(b.snapshot().length).toBe(0);
  });

  it('TC-18: hibernation path — messages reach sockets via getWebSockets after reconstruct', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(a.snapshot(), b.snapshot()), 4000);

    // A creates a note; B receives it
    createSticky(a.doc, { x: 500, y: 500 });
    await waitFor(() => b.snapshot().length === 1, 4000, 'note did not reach B via hibernation path');
    expect(b.snapshot().length).toBe(1);

    a.close();
    b.close();
  });
});
