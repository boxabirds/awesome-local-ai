import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { build25NoteBoard, truncated } from '../fixtures/boards';
import { WsClient, converge, openSocket, settle, waitUntil } from './helpers/ws-client';

const stubOf = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
const rows = (storage: DurableObjectStorage, table: string) =>
  Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
const snap = (doc: Y.Doc) => JSON.stringify(snapshot(doc));
const closed = (c: WsClient) => waitUntil(() => c.closeCode !== null, 10_000, 'socket close');

function syncFrame(kind: 'step2' | 'update', update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  if (kind === 'update') syncProtocol.writeUpdate(enc, update);
  else {
    encoding.writeVarUint(enc, syncProtocol.messageYjsSyncStep2);
    encoding.writeVarUint8Array(enc, update);
  }
  return encoding.toUint8Array(enc);
}

/** Seeds a board with 25 notes through a real client, forces compaction, then leaves. */
async function seed25(id: string, opts: { compact?: boolean } = {}): Promise<Y.Doc> {
  const a = await WsClient.connect(id);
  await a.waitForSync();
  build25NoteBoard(a.doc);
  const reference = new Y.Doc();
  Y.applyUpdate(reference, Y.encodeStateAsUpdate(a.doc));
  await settle(300);
  if (opts.compact) await runInDurableObject(stubOf(id), (room: BoardRoom) => { room.store.compactIfNeeded(room.doc!, true); });
  a.close();
  await settle(100);
  return reference;
}

describe('persistent BoardRoom (persist.room)', () => {
  it('TC-12 the row is stored by the time another client sees the change', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    const stub = stubOf(id);
    const seenInStorage: number[] = [];
    b.doc.on('update', () => { seenInStorage.push(-1); });
    createSticky(a.doc, { x: 10, y: 20 });
    await waitUntil(() => b.snapshot().length === 1, 10_000, 'B sees the note');
    const check = await runInDurableObject(stub, (_room, state) => {
      const fresh = new Y.Doc();
      const store = new BoardStore(state.storage);
      store.migrate();
      store.load(fresh);
      return { n: rows(state.storage, 'updates'), notes: snapshot(fresh).length };
    });
    expect(check.n).toBeGreaterThanOrEqual(1);
    expect(check.notes).toBe(1);
    a.close(); b.close();
  });

  it('TC-13 after everyone leaves and the room is rebuilt, a new client gets the identical board', async () => {
    const id = newBoardId();
    const reference = await seed25(id);
    // A brand-new room instance over the same storage (what a restart or wake does).
    await runInDurableObject(stubOf(id), async (_room, state) => {
      const fresh = new BoardRoom(state, env);
      await settle(20); // the constructor's blockConcurrencyWhile(load) completes
      expect(fresh.state).toBe('ready');
      expect(snap(fresh.doc!)).toBe(snap(reference));
    });
    const c = await WsClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot()).toHaveLength(25);
    expect(snap(c.doc)).toBe(snap(reference));
    c.close();
  });

  it('TC-14 a failed save is never broadcast and is saved after reconnect from the open page', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    const stub = stubOf(id);
    await runInDurableObject(stub, (room: BoardRoom) => {
      const real = room.store.append.bind(room.store);
      let first = true;
      room.store.append = (u: Uint8Array) => {
        if (first) { first = false; throw new Error('injected write failure'); }
        real(u);
      };
    });
    const bBefore = b.updatesReceived;
    createSticky(a.doc, { x: 5, y: 5 });
    await Promise.all([closed(a), closed(b)]);
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.updatesReceived).toBe(bBefore);
    expect(b.snapshot()).toHaveLength(0);
    expect(await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates'))).toBe(0);

    // Reconnect: A still holds the change in its open page and re-sends it via the handshake.
    a.close(); b.close();
    const b2 = await WsClient.connect(id, b.doc);
    const a2 = await WsClient.connect(id, a.doc);
    await Promise.all([a2.waitForSync(), b2.waitForSync()]);
    await converge([a2, b2]);
    expect(b2.snapshot()).toHaveLength(1);
    expect(await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates'))).toBeGreaterThanOrEqual(1);
    a2.close(); b2.close();
  });

  it('TC-15 an unreadable snapshot closes clients with 4500 and stores nothing', async () => {
    const id = newBoardId();
    await seed25(id, { compact: true });
    const stub = stubOf(id);
    await runInDurableObject(stub, (room: BoardRoom, state) => {
      const chunk = new Uint8Array(state.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
      room.resetRoom();
    });
    const before = await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates') + rows(s.storage, 'snapshot_chunks'));

    const ws = await openSocket(id);
    let code: number | null = null;
    ws.addEventListener('close', (ev: CloseEvent) => { code = ev.code; });
    const doc = new Y.Doc();
    createSticky(doc, { x: 1, y: 1 });
    try { ws.send(syncFrame('step2', Y.encodeStateAsUpdate(doc))); } catch { /* already closed by the room */ }
    await waitUntil(() => code !== null, 10_000, 'close');
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
    await settle();
    const after = await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates') + rows(s.storage, 'snapshot_chunks'));
    expect(after).toBe(before);
    expect(await runInDurableObject(stub, (room: BoardRoom) => room.state)).toBe('load-failed');
  });

  it('TC-16 a load-failed room retries only after LOAD_RETRY_MIN_INTERVAL_MS, then recovers', async () => {
    const id = newBoardId();
    const reference = await seed25(id, { compact: true });
    const stub = stubOf(id);
    const original = await runInDurableObject(stub, (room: BoardRoom, state) => {
      const chunk = new Uint8Array(state.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
      room.resetRoom();
      return chunk;
    });
    const first = await WsClient.connect(id);
    await closed(first);
    expect(first.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the storage; a connection before the interval must still be refused (no reload attempt).
    await runInDurableObject(stub, (_room, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
    });
    const early = await WsClient.connect(id);
    await closed(early);
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    await runInDurableObject(stub, (room: BoardRoom) => { room.loadFailedAt -= LOAD_RETRY_MIN_INTERVAL_MS; });
    const late = await WsClient.connect(id);
    await late.waitForSync();
    expect(late.closeCode).toBeNull();
    expect(snap(late.doc)).toBe(snap(reference));
    late.close();
  });

  it('TC-17 an undecodable update closes the socket with 1003 and is not stored', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    await a.waitForSync();
    createSticky(a.doc, { x: 1, y: 1 });
    await settle(200);
    const stub = stubOf(id);
    const before = await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates'));
    const garbage = encoding.createEncoder();
    encoding.writeVarUint(garbage, MESSAGE_SYNC);
    encoding.writeVarUint(garbage, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(garbage, new Uint8Array([255, 255, 255, 255, 9, 9]));
    a.ws.send(encoding.toUint8Array(garbage));
    await closed(a);
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await runInDurableObject(stub, (_r, s) => rows(s.storage, 'updates'))).toBe(before);
  });

  it('TC-18 after the room is reconstructed, sockets accepted earlier still receive broadcasts', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 1, y: 1 });
    await converge([a, b]);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(a.doc));
    const before = doc.getMap('objects').size;
    createSticky(doc, { x: 50, y: 60 });
    const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(a.doc));
    await runInDurableObject(stubOf(id), async (_room, state) => {
      const rebuilt = new BoardRoom(state, env); // simulates waking from hibernation
      await settle(20);
      const sockets = state.getWebSockets();
      expect(sockets.length).toBeGreaterThanOrEqual(2);
      rebuilt.webSocketMessage(sockets[0], syncFrame('update', update).slice().buffer as ArrayBuffer);
    });
    expect(before).toBe(1);
    // The sender (whichever socket was used) does not get an echo; the other client must receive it.
    await waitUntil(() => a.snapshot().length === 2 || b.snapshot().length === 2, 10_000, 'broadcast after reconstruct');
    expect(await runInDurableObject(stubOf(id), (_r, s) => rows(s.storage, 'updates'))).toBeGreaterThanOrEqual(2);
    a.close(); b.close();
  });

  it('TC-26 a SQL error while reading closes new sockets with 4500', async () => {
    const id = newBoardId();
    await seed25(id);
    const stub = stubOf(id);
    await stub.initialize(); // the board exists before its storage starts failing
    const restore = await runInDurableObject(stub, (room: BoardRoom, state) => {
      const original = room.store;
      const failing = {
        transactionSync: <R>(fn: () => R) => state.storage.transactionSync(fn),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (query.startsWith('SELECT')) throw new Error('injected read failure');
            return state.storage.sql.exec(query, ...(bindings as never[]));
          },
        },
      } as unknown as DurableObjectStorage;
      room.store = new BoardStore(failing);
      const result = room.store.load(new Y.Doc());
      expect(result).toMatchObject({ ok: false, reason: 'sql-error' });
      room.resetRoom();
      return () => original;
    });
    void restore;
    const c = await WsClient.connect(id, new Y.Doc(), false);
    await closed(c);
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await runInDurableObject(stub, (room: BoardRoom) => room.state)).toBe('load-failed');
  });

  it('test hooks are inert when TEST_HOOKS is not set (production configuration)', async () => {
    expect(env.TEST_HOOKS).toBeUndefined();
    const res = await SELF.fetch(`http://example.com/__test/boards/${newBoardId()}/corrupt-snapshot`, { method: 'POST' });
    const body = await res.text();
    expect(body).not.toMatch(/corrupted|no snapshot|repaired/);
    await expect(runInDurableObject(stubOf(newBoardId()), (room: BoardRoom) => room.testHook('repair'))).rejects.toThrow(/disabled/);
  });
});
