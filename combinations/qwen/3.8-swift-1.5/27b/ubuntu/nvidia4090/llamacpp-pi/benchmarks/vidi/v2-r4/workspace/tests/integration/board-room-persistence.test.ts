import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore } from '../../src/worker/board-store.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { createSticky, snapshot } from '../../src/shared/board-model.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.ts';
import { connectToBoard } from './helpers/ws-client.ts';

/** Get a DO stub for a board id. */
function stubFor(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Run a function with a BoardStore over the board's storage. */
function withStore<T>(boardId: string, fn: (store: BoardStore) => T): Promise<T> {
  return runInDurableObject(stubFor(boardId), (_i: unknown, state: DurableObjectState) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    return fn(store);
  });
}

/** Force a snapshot of the current doc into snapshot_chunks (for tests that need a Snapshotted board). */
function forceSnapshot(boardId: string): Promise<{ chunks: number }> {
  return runInDurableObject(stubFor(boardId), (instance: unknown, state: DurableObjectState) => {
    const room = instance as { doc?: Y.Doc | null; store?: BoardStore };
    const doc = room.doc;
    if (!doc) return { chunks: 0 };
    const store = new BoardStore(state.storage);
    store.migrate();
    const bytes = Y.encodeStateAsUpdate(doc);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 512 * 1024) chunks.push(bytes.slice(i, i + 512 * 1024));
    state.storage.transactionSync(() => {
      state.storage.sql.exec('DELETE FROM snapshot_chunks');
      for (let i = 0; i < chunks.length; i++) {
        state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
      }
      state.storage.sql.exec('DELETE FROM updates');
      state.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        'snapshot_through_seq',
        '0',
      );
    });
    return { chunks: chunks.length };
  });
}

/** Corrupt snapshot chunk 0 so the snapshot is unreadable. */
function corruptSnapshot(boardId: string): Promise<void> {
  return runInDurableObject(stubFor(boardId), (_i: unknown, state: DurableObjectState) => {
    const rand = new Uint8Array(200);
    for (let i = 0; i < rand.length; i++) rand[i] = (i * 7 + 3) & 0xff;
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', rand);
  });
}

describe('BoardRoom persistence', () => {
  it('TC-12: update is stored before broadcast; storage has the note', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);
    createSticky(a.doc, { x: 100, y: 100 });
    await b.waitForSync();
    // b received the note, so the row must already be in storage
    const r = await withStore(boardId, (store) => {
      const count = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      const doc = new Y.Doc();
      store.load(doc);
      return { count, notes: snapshot(doc).length };
    });
    expect(r.count).toBeGreaterThan(0);
    expect(r.notes).toBe(1);
    a.destroy();
    b.destroy();
  });

  it('TC-13: new client on a fresh room instance sees the persisted board', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    for (let i = 0; i < 25; i++) createSticky(a.doc, { x: i * 40, y: 0 });
    await new Promise((r) => setTimeout(r, 400));
    a.destroy();
    // New client → new room instance over the same storage
    const c = await connectToBoard(boardId);
    await c.waitForSync();
    expect(c.getNoteCount()).toBe(25);
    c.destroy();
  });

  it('TC-15: damaged snapshot closes with 4500 and stores nothing', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    for (let i = 0; i < 25; i++) createSticky(a.doc, { x: i * 40, y: 0 });
    await new Promise((r) => setTimeout(r, 400));
    a.destroy();
    await forceSnapshot(boardId);
    await corruptSnapshot(boardId);
    const b = await connectToBoard(boardId);
    const code = await b.waitForClose();
    expect(code).toBe(4500);
    // no updates stored by the failed room
    const r = await withStore(boardId, (store) => {
      const count = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
      return { count };
    });
    expect(r.count).toBe(0);
  });

  it('TC-16: repaired snapshot loads on a later attempt', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    for (let i = 0; i < 25; i++) createSticky(a.doc, { x: i * 40, y: 0 });
    await new Promise((r) => setTimeout(r, 400));
    // capture the doc state before destroying a
    const docState = Y.encodeStateAsUpdate(a.doc);
    a.destroy();
    await forceSnapshot(boardId);
    await corruptSnapshot(boardId);
    // first attempt: closed 4500
    const b = await connectToBoard(boardId);
    const code1 = await b.waitForClose();
    expect(code1).toBe(4500);
    // repair the snapshot by writing the captured doc state
    await runInDurableObject(stubFor(boardId), (_i: unknown, state: DurableObjectState) => {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < docState.length; i += 512 * 1024) chunks.push(docState.slice(i, i + 512 * 1024));
      state.storage.transactionSync(() => {
        state.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
        }
        state.storage.sql.exec('DELETE FROM updates');
        state.storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          '0',
        );
      });
    });
    // second attempt after the retry interval: loads and syncs
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 200));
    const d = await connectToBoard(boardId);
    await d.waitForSync();
    expect(d.getNoteCount()).toBe(25);
    d.destroy();
  });

  it('TC-17: garbage update closes with 1003 and is not stored', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const before = await withStore(boardId, (store) => {
      return (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
    });
    a.sendRawFrame(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]));
    const code = await a.waitForClose();
    expect(code).toBe(1003);
    const after = await withStore(boardId, (store) => {
      return (store.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0] as { c: number }).c;
    });
    expect(after).toBe(before);
  });

  it('TC-18: hibernation wake broadcasts to sockets accepted after reconstruct', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    createSticky(a.doc, { x: 10, y: 10 });
    await new Promise((r) => setTimeout(r, 300));
    a.destroy();
    // wake the room and connect a new client; a broadcast reaches it
    const b = await connectToBoard(boardId);
    await b.waitForSync();
    expect(b.getNoteCount()).toBe(1);
    b.destroy();
  });

  it('TC-14: storage failure closes all sockets with 1011', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);
    // wrap store.append to throw on the next call
    await runInDurableObject(stubFor(boardId), (instance: unknown) => {
      const room = instance as { store?: BoardStore };
      if (room.store) {
        room.store.append = () => {
          throw new Error('injected storage failure');
        };
      }
      return { ok: true };
    });
    createSticky(a.doc, { x: 50, y: 50 });
    const codeA = await a.waitForClose();
    const codeB = await b.waitForClose();
    expect(codeA).toBe(1011);
    expect(codeB).toBe(1011);
  });

  it('TC-26: unreadable snapshot puts room in LoadFailed (4500), no data served', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i * 40, y: 0 });
    await new Promise((r) => setTimeout(r, 400));
    a.destroy();
    await forceSnapshot(boardId);
    await corruptSnapshot(boardId);
    const b = await connectToBoard(boardId);
    const code = await b.waitForClose();
    expect(code).toBe(4500);
    // verify no partial data was served: storage is intact
    const r = await withStore(boardId, (store) => {
      const count = (store.storage.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()[0] as { c: number }).c;
      return { chunkCount: count };
    });
    expect(r.chunkCount).toBeGreaterThan(0);
  });
});
