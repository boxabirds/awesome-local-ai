import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, moveObject, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { retroBoard, truncated } from '../fixtures/boards';
import { connect, converged, fetchWorker, openSocket, sleep, until, WsClient } from './ws-client';

const stubFor = (board: string) => {
  const ns = (env as unknown as { BOARD_ROOM: DurableObjectNamespace<BoardRoom> }).BOARD_ROOM;
  return ns.get(ns.idFromName(board));
};

type Internals = {
  store: BoardStore;
  doc: Y.Doc | null;
  state: string;
  loadFromStorage(): void;
  loadFailedAt: number;
};

const inRoom = <T>(board: string, fn: (room: Internals, storage: DurableObjectStorage) => T | Promise<T>) =>
  runInDurableObject(stubFor(board), (i, s) => fn(i as unknown as Internals, s.storage));

const rowCount = (board: string, table = 'updates') =>
  inRoom(board, (_r, st) => Number(st.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n));

/** Seeds a board with the 25-note retro fixture through a real client, then disconnects it. */
async function seedRetro(board: string) {
  const { doc } = retroBoard();
  const c = await connect(board, doc);
  await sleep(50);
  return { client: c, doc };
}

async function waitStored(board: string, notes: number) {
  for (let i = 0; i < 200; i++) {
    const n = await inRoom(board, (r) => snapshot(r.doc!).length);
    if (n === notes) return;
    await sleep(10);
  }
  throw new Error('board never reached expected note count');
}

describe('BoardRoom persistence', () => {
  it('TC-12: the row exists by the time another client sees the change', async () => {
    const board = newBoardId();
    const a = await connect(board);
    const b = await connect(board);
    createSticky(a.doc, { x: 10, y: 20 });
    await until(() => b.snapshot().length === 1, 5000, 'note on B');
    const rowsWhenSeen = await rowCount(board);
    expect(rowsWhenSeen).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    const fresh = await inRoom(board, (r, st) => {
      const doc = new Y.Doc();
      expect(new BoardStore(st).load(doc).ok).toBe(true);
      return snapshot(doc);
    });
    expect(fresh).toHaveLength(1);
  });

  it('TC-13: after everyone leaves and the room is rebuilt, a new client gets the same board', async () => {
    const board = newBoardId();
    const { client, doc } = await seedRetro(board);
    await waitStored(board, 25);
    const expected = snapshot(doc);
    client.close();
    await evictDurableObject(stubFor(board), { webSockets: 'close' });
    const c = await connect(board);
    expect(c.snapshot()).toEqual(expected);
    expect(c.snapshot()).toHaveLength(25);
  });

  it('TC-14: a failed save is never broadcast and is saved from the open page on reconnect', async () => {
    const board = newBoardId();
    const a = await connect(board);
    const b = await connect(board);
    await inRoom(board, (r) => {
      const real = r.store.append.bind(r.store);
      let failed = false;
      r.store.append = (u: Uint8Array) => {
        if (!failed) { failed = true; throw new Error('disk full'); }
        real(u);
      };
    });
    const docA = a.doc;
    createSticky(docA, { x: 1, y: 2 });
    await until(() => a.closeCode === CLOSE_STORAGE_FAILURE && b.closeCode === CLOSE_STORAGE_FAILURE, 5000, 'close 1011');
    expect(b.snapshot()).toHaveLength(0);
    expect(b.updateMessages).toBe(0);
    expect(await rowCount(board)).toBe(0);

    const b2 = await connect(board);
    const a2 = await connect(board, docA); // A still holds the change and re-sends it
    await until(() => b2.snapshot().length === 1, 5000, 'note delivered to B');
    expect(await rowCount(board)).toBeGreaterThanOrEqual(1);
    await converged([a2, b2]);
  });

  describe('damaged snapshot', () => {
    async function brokenBoard() {
      const board = newBoardId();
      const { client } = await seedRetro(board);
      await waitStored(board, 25);
      client.close();
      await inRoom(board, (r, st) => {
        expect(r.store.compactIfNeeded(r.doc!, true)).toBe(true);
        const chunk = new Uint8Array(st.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
        st.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
        r.loadFromStorage();
      });
      return board;
    }

    it('TC-15: clients are closed 4500 and nothing they send is stored', async () => {
      const board = await brokenBoard();
      const before = await rowCount(board);
      const c = new WsClient(await openSocket(board), new Y.Doc());
      createSticky(c.doc, { x: 5, y: 5 }); // would be sent as an update
      await until(() => c.closeCode === CLOSE_BOARD_LOAD_FAILED, 5000, 'close 4500');
      expect(c.synced).toBe(false);
      expect(await rowCount(board)).toBe(before);
      expect(await inRoom(board, (r) => r.state)).toBe('load-failed');
    });

    it('TC-16: retries only after LOAD_RETRY_MIN_INTERVAL_MS, then loads and syncs', async () => {
      const board = await brokenBoard();
      // Repair storage (a fresh snapshot of the original board).
      const { doc } = retroBoard();
      const good = Y.encodeStateAsUpdate(doc);
      await inRoom(board, (_r, st) => { st.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', good); });

      // Before the interval: closed 4500 without a reload attempt, even though storage is now fine.
      const early = new WsClient(await openSocket(board), new Y.Doc());
      await until(() => early.closeCode === CLOSE_BOARD_LOAD_FAILED, 5000, 'close 4500');
      expect(await inRoom(board, (r) => r.state)).toBe('load-failed');

      // After the interval: the load is attempted again and succeeds.
      await inRoom(board, (r) => { r.loadFailedAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS; });
      const c = await connect(board);
      expect(c.snapshot()).toHaveLength(25);
      expect(await inRoom(board, (r) => r.state)).toBe('ready');
    });
  });

  it('TC-17: a garbage update closes only the sender with 1003 and stores nothing', async () => {
    const board = newBoardId();
    const a = await connect(board);
    const b = await connect(board);
    createSticky(a.doc, { x: 0, y: 0 });
    await converged([a, b]);
    const before = await rowCount(board);
    b.sendRaw(new Uint8Array([MESSAGE_SYNC, 2, 5, 255, 255, 255, 255, 255]));
    await until(() => b.closeCode === CLOSE_UNSUPPORTED_DATA, 5000, 'close 1003');
    await sleep(50);
    expect(await rowCount(board)).toBe(before);
    expect(a.closeCode).toBeNull();
  });

  it('TC-18: sockets survive the room being rebuilt (hibernation)', async () => {
    const board = newBoardId();
    const a = await connect(board);
    const b = await connect(board);
    createSticky(a.doc, { x: 3, y: 3 });
    await converged([a, b]);
    const before = await inRoom(board, (r) => r);
    await evictDurableObject(stubFor(board)); // hibernates the sockets and drops the instance
    const after = await inRoom(board, (r) => r);
    expect(after).not.toBe(before);
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();
    const id = a.snapshot()[0].id;
    moveObject(a.doc, id, 700, 800);
    createSticky(a.doc, { x: 9, y: 9 });
    await until(() => b.snapshot().length === 2 && b.snapshot().some((n) => n.x === 700), 5000, 'update after wake');
    expect(await rowCount(board)).toBeGreaterThanOrEqual(3);
  });

  it('TC-26: a SQL error while loading puts the room in load-failed (4500)', async () => {
    const board = newBoardId();
    const { client } = await seedRetro(board);
    await waitStored(board, 25);
    client.close();
    await inRoom(board, (r, st) => {
      const throwing = {
        transactionSync: st.transactionSync.bind(st),
        sql: {
          exec: (q: string, ...b: unknown[]) => {
            if (q.startsWith('SELECT seq, data FROM updates')) throw new Error('read failed');
            return st.sql.exec(q, ...(b as never[]));
          },
        },
      } as unknown as DurableObjectStorage;
      const bad = new BoardStore(throwing);
      const result = bad.load(new Y.Doc());
      expect(result).toMatchObject({ ok: false, reason: 'sql-error' });
      r.store.load = (d: Y.Doc) => bad.load(d);
      r.loadFromStorage();
    });
    const c = new WsClient(await openSocket(board), new Y.Doc());
    await until(() => c.closeCode === CLOSE_BOARD_LOAD_FAILED, 5000, 'close 4500');
    expect(c.synced).toBe(false);
  });

  it('test hooks are absent when TEST_HOOKS is not set (production configuration)', async () => {
    for (const action of ['corrupt-snapshot', 'repair']) {
      const res = await fetchWorker(`https://example.com/__test/boards/${newBoardId()}/${action}`, { method: 'POST' });
      expect(await res.text()).not.toMatch(/corrupted|repaired/);
    }
  });
});
