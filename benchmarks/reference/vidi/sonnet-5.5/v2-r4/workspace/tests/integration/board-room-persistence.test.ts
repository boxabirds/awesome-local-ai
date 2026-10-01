import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { BoardStore, type StoreStorage } from '../../src/worker/board-store';
import { exports } from 'cloudflare:workers';
import { PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { boardJson, largeBoard, retroBoard25 } from '../fixtures/boards';
import { WsClient, sleep, waitFor } from './ws-client';

const stubFor = (id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
const count = (state: DurableObjectState, table: string) =>
  Number(state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);

/** Writes the 25-note retro board through a real client and leaves the room with nobody connected. */
async function seed25(id: string): Promise<Y.Doc> {
  const c = await WsClient.connect(id);
  const { doc } = retroBoard25();
  Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(doc));
  const expected = boardJson(doc);
  await sleep(100);
  await waitFor(() => c.isOpen, 'open');
  const probe = await WsClient.connect(id);
  await waitFor(() => boardJson(probe.doc) === expected, 'seeded board visible');
  c.close();
  probe.close();
  await sleep(50);
  return doc;
}

/** Compacts the live doc and truncates snapshot chunk 0, then drops the in-memory room. */
async function breakSnapshot(id: string): Promise<{ repair(): Promise<void> }> {
  const stub = stubFor(id);
  let original!: Uint8Array;
  await runInDurableObject(stub, (room, state) => {
    expect(room.store.compact(room.doc!)).toBe(true);
    original = new Uint8Array(state.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice(0, original.length - 10));
  });
  await evictDurableObject(stub);
  return {
    repair: () =>
      runInDurableObject(stub, (_room, state) => {
        state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
      }),
  };
}

describe('persistent BoardRoom', () => {
  it('TC-12: a change is in storage by the time another client sees it', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    const noteId = createSticky(a.doc, { x: 10, y: 20 });
    await waitFor(() => b.snapshot().some((n) => n.id === noteId), 'note on B');
    await runInDurableObject(stubFor(id), (_room, state) => {
      expect(count(state, 'updates')).toBeGreaterThanOrEqual(1);
      const fresh = new Y.Doc();
      expect(new BoardStore(state.storage as unknown as StoreStorage).load(fresh)).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(fresh).map((n) => n.id)).toEqual([noteId]);
    });
    a.close();
    b.close();
  });

  it('TC-13: after everyone leaves and the room is dropped, a new client gets the same board', async () => {
    const id = newBoardId();
    const original = await seed25(id);
    await evictDurableObject(stubFor(id));
    const c = await WsClient.connect(id);
    expect(snapshot(c.doc)).toHaveLength(25);
    expect(boardJson(c.doc)).toBe(boardJson(original));
    c.close();
  });

  it('TC-14: a failed save is not broadcast; after reconnecting it is saved and delivered', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    await runInDurableObject(stubFor(id), (room) => {
      const append = room.store.append.bind(room.store);
      let failed = false;
      room.store.append = (u: Uint8Array) => {
        if (!failed) {
          failed = true;
          throw new Error('disk full');
        }
        append(u);
      };
    });
    const noteId = createSticky(a.doc, { x: 1, y: 1 });
    await waitFor(() => a.closeCode !== null && b.closeCode !== null, 'both closed');
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.snapshot()).toHaveLength(0);
    await runInDurableObject(stubFor(id), (_room, state) => expect(count(state, 'updates')).toBe(0));

    // A still holds the change in its page and re-sends it through the sync handshake.
    const a2 = await WsClient.connect(id, { doc: a.doc });
    const b2 = await WsClient.connect(id);
    await waitFor(() => b2.snapshot().some((n) => n.id === noteId), 'note delivered after reconnect');
    await runInDurableObject(stubFor(id), (_room, state) => expect(count(state, 'updates')).toBeGreaterThanOrEqual(1));
    a2.close();
    b2.close();
  });

  it('TC-15: a room that cannot load closes clients with 4500 and stores nothing they send', async () => {
    const id = newBoardId();
    await seed25(id);
    await breakSnapshot(id);
    const before = await runInDurableObject(stubFor(id), (_room, state) => ({
      log: count(state, 'updates'),
      chunks: count(state, 'snapshot_chunks'),
    }));

    const c = await WsClient.connect(id, { waitForSync: false });
    createSticky(c.doc, { x: 5, y: 5 }); // sent as an update right away, racing the close
    await waitFor(() => c.closeCode !== null, 'closed');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.synced).toBe(false);
    const after = await runInDurableObject(stubFor(id), (room, state) => {
      expect(room.lifecycle).toBe('load-failed');
      return { log: count(state, 'updates'), chunks: count(state, 'snapshot_chunks') };
    });
    expect(after).toEqual(before);
  });

  it('TC-16: retry only after LOAD_RETRY_MIN_INTERVAL_MS; once repaired the board loads and syncs', async () => {
    const id = newBoardId();
    const original = await seed25(id);
    const { repair } = await breakSnapshot(id);
    const early = await WsClient.connect(id, { waitForSync: false });
    await waitFor(() => early.closeCode !== null, 'first attempt closed');
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    await repair();
    // Storage is healthy now, but the interval has not elapsed: no reload attempt, still 4500.
    const tooSoon = await WsClient.connect(id, { waitForSync: false });
    await waitFor(() => tooSoon.closeCode !== null, 'second attempt closed');
    expect(tooSoon.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    await runInDurableObject(stubFor(id), (room) => {
      room.loadFailedAt -= LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const later = await WsClient.connect(id);
    expect(boardJson(later.doc)).toBe(boardJson(original));
    later.close();
  });

  it('TC-17: a garbage update closes the client with 1003 and stores nothing', async () => {
    const id = newBoardId();
    const c = await WsClient.connect(id);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeVarUint(enc, 2); // messageYjsUpdate
    encoding.writeVarUint8Array(enc, Uint8Array.from([255, 255, 255, 1, 2, 3]));
    c.sendBytes(encoding.toUint8Array(enc));
    await waitFor(() => c.closeCode !== null, 'closed');
    expect(c.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    await runInDurableObject(stubFor(id), (_room, state) => expect(count(state, 'updates')).toBe(0));
  });

  it('TC-18: sockets accepted before the room was dropped keep working afterwards (hibernation)', async () => {
    const id = newBoardId();
    const a = await WsClient.connect(id);
    const b = await WsClient.connect(id);
    const first = createSticky(a.doc, { x: 1, y: 1 });
    await waitFor(() => b.snapshot().some((n) => n.id === first), 'first note on B');

    await evictDurableObject(stubFor(id)); // hibernates the sockets and drops the in-memory room
    const second = createSticky(a.doc, { x: 2, y: 2 });
    await waitFor(() => b.snapshot().some((n) => n.id === second), 'second note on B after wake');
    expect(b.closeCode).toBeNull();
    expect(a.closeCode).toBeNull();
    await runInDurableObject(stubFor(id), (room, state) => {
      expect(snapshot(room.doc!)).toHaveLength(2);
      expect(count(state, 'updates')).toBeGreaterThanOrEqual(2);
    });
    a.close();
    b.close();
  });

  it('TC-26: a SQL error while loading puts the room in load-failed and clients get 4500', async () => {
    const id = newBoardId();
    await seed25(id);
    await runInDurableObject(stubFor(id), (room, state) => {
      const real = state.storage as unknown as StoreStorage;
      const failing: StoreStorage = {
        transactionSync: (fn) => real.transactionSync(fn),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (/FROM updates/.test(query)) throw new Error('injected read failure');
            return real.sql.exec(query, ...bindings);
          },
        },
      };
      room.store = new BoardStore(failing);
      room.loadNow();
      expect(room.lifecycle).toBe('load-failed');
    });
    const c = await WsClient.connect(id, { waitForSync: false });
    await waitFor(() => c.closeCode !== null, 'closed');
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.synced).toBe(false);
  });

  it('an update larger than one storage row is kept as snapshot chunks and survives a reload', async () => {
    const id = newBoardId();
    const { doc } = largeBoard(PERSIST_TESTED_NOTES);
    const huge = Y.encodeStateAsUpdate(doc);
    expect(huge.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    const c = await WsClient.connect(id);
    Y.applyUpdate(c.doc, huge); // one single update message
    await sleep(300);
    await runInDurableObject(stubFor(id), (_room, state) => {
      expect(count(state, 'updates')).toBe(0);
      expect(count(state, 'snapshot_chunks')).toBeGreaterThan(1);
    });
    c.close();
    await evictDurableObject(stubFor(id));
    const d = await WsClient.connect(id);
    expect(snapshot(d.doc)).toHaveLength(PERSIST_TESTED_NOTES);
    expect(boardJson(d.doc)).toBe(boardJson(doc));
    d.close();
  });

  it('the test-only corruption hook routes do not exist without TEST_HOOKS', async () => {
    const res = await exports.default.fetch(`http://example.com/__test/boards/${newBoardId()}/corrupt-snapshot`, { method: 'POST' });
    expect(await res.text()).not.toBe('ok');
  });
});
