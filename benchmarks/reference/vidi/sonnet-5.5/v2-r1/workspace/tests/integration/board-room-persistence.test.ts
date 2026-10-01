import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import { retroBoard, truncated } from '../fixtures/boards';
import { WsClient, converged, waitFor } from './ws-client';

const stubFor = (boardId: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
const sorted = (doc: Y.Doc) => JSON.stringify([...snapshot(doc)].sort((a, b) => (a.id < b.id ? -1 : 1)));
const updateRows = (boardId: string) =>
  runInDurableObject(stubFor(boardId), (_i, state) =>
    Number(state.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').one().n),
  );
const closed = (c: WsClient) => waitFor(() => c.closeCode !== undefined, 'socket close');
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

async function pair(boardId = newBoardId()) {
  const a = await WsClient.connect(boardId);
  const b = await WsClient.connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return { boardId, a, b };
}

/** Writes a 25-note board through a client, compacts it, and returns the doc as stored. */
async function seedCompacted(boardId: string): Promise<Y.Doc> {
  const a = await WsClient.connect(boardId);
  await a.waitForSync();
  retroBoard(a.doc);
  const expected = new Y.Doc();
  Y.applyUpdate(expected, Y.encodeStateAsUpdate(a.doc));
  const probe = await WsClient.connect(boardId);
  await probe.waitForSync();
  await converged([a, probe]);
  a.close();
  probe.close();
  await runInDurableObject(stubFor(boardId), (instance, state) => {
    const doc = new Y.Doc();
    const store = new BoardStore(state.storage);
    store.load(doc);
    expect(store.compactIfNeeded(doc, true)).toBe(true);
    instance.reload();
  });
  return expected;
}

const corruptChunk0 = (boardId: string) =>
  runInDurableObject(stubFor(boardId), (instance, state) => {
    const row = state.storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
    const original = new Uint8Array(row.data as ArrayBuffer);
    state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(original).slice());
    const errors = quiet();
    instance.reload();
    errors.mockRestore();
    return original;
  });

describe('persistent BoardRoom', () => {
  it('TC-12: the update row exists by the time another client sees the change', async () => {
    const { boardId, a, b } = await pair();
    const id = createSticky(a.doc, { x: 5, y: 6 }) as string;
    await waitFor(() => snapshot(b.doc).length === 1, 'B sees the note');
    expect(await updateRows(boardId)).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    const fresh = await runInDurableObject(stubFor(boardId), (_i, state) => {
      const doc = new Y.Doc();
      expect(new BoardStore(state.storage).load(doc).ok).toBe(true);
      return snapshot(doc);
    });
    expect(fresh.map((n) => n.id)).toEqual([id]);
  });

  it('TC-13: a board reopened after everyone left (fresh room instance) is identical', async () => {
    const { boardId, a, b } = await pair();
    retroBoard(a.doc);
    await converged([a, b]);
    const expected = sorted(a.doc);
    expect(snapshot(a.doc)).toHaveLength(25);
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 50));
    await runInDurableObject(stubFor(boardId), (instance) => void instance.reload());
    const c = await WsClient.connect(boardId);
    await c.waitForSync();
    expect(sorted(c.doc)).toBe(expected);
  });

  it('TC-14: a failed save is not broadcast; after reconnecting it is saved and delivered', async () => {
    const { boardId, a, b } = await pair();
    await runInDurableObject(stubFor(boardId), (instance) => {
      const original = instance.store.append.bind(instance.store);
      let failed = false;
      instance.store.append = (u: Uint8Array) => {
        if (!failed) {
          failed = true;
          throw new Error('disk full');
        }
        original(u);
      };
    });
    const errors = quiet();
    const received = b.updateMessages.length;
    const rowsBefore = await updateRows(boardId);
    const id = createSticky(a.doc, { x: 1, y: 2 }) as string;
    await Promise.all([closed(a), closed(b)]);
    errors.mockRestore();
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.updateMessages.length).toBe(received);
    expect(snapshot(b.doc)).toHaveLength(0);
    expect(await updateRows(boardId)).toBe(rowsBefore);

    // A still holds the change in its open page and re-sends it on reconnecting.
    const held = Y.encodeStateAsUpdate(a.doc);
    const a2 = await WsClient.connect(boardId, (d) => Y.applyUpdate(d, held));
    const b2 = await WsClient.connect(boardId);
    await Promise.all([a2.waitForSync(), b2.waitForSync()]);
    await waitFor(() => snapshot(b2.doc).some((n) => n.id === id), 'B receives the held change');
    expect(await updateRows(boardId)).toBeGreaterThan(rowsBefore);
  });

  it('TC-15: a room whose snapshot is damaged closes with 4500 and stores nothing', async () => {
    const boardId = newBoardId();
    await seedCompacted(boardId);
    await corruptChunk0(boardId);
    const rowsBefore = await updateRows(boardId);
    const c = await WsClient.connect(boardId, (d) => {
      createSticky(d, { x: 0, y: 0 });
    });
    await closed(c);
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(c.received.filter((m) => m.syncType === 1)).toHaveLength(0); // never served an (empty) doc
    expect(await updateRows(boardId)).toBe(rowsBefore);
    expect(await runInDurableObject(stubFor(boardId), (i) => i.state)).toBe('load-failed');
  });

  it('TC-16: a damaged room retries loading only after LOAD_RETRY_MIN_INTERVAL_MS', async () => {
    const boardId = newBoardId();
    const expected = await seedCompacted(boardId);
    const original = await corruptChunk0(boardId);
    const early = await WsClient.connect(boardId);
    await closed(early);
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repaired storage is not noticed before the interval has passed (no reload attempt).
    await runInDurableObject(stubFor(boardId), (_i, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice());
    });
    const stillEarly = await WsClient.connect(boardId);
    await closed(stillEarly);
    expect(stillEarly.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 100));
    const late = await WsClient.connect(boardId);
    await late.waitForSync();
    expect(late.closeCode).toBeUndefined();
    expect(sorted(late.doc)).toBe(sorted(expected));
  });

  it('TC-17: a garbage update closes with 1003 and is not stored', async () => {
    const { boardId, a } = await pair();
    const before = await updateRows(boardId);
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, 2); // update
    encoding.writeVarUint8Array(frame, Uint8Array.from([255, 255, 255, 255]));
    a.sendRaw(encoding.toUint8Array(frame));
    await closed(a);
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await updateRows(boardId)).toBe(before);
  });

  it('TC-18: sockets accepted before the room object is reconstructed keep working', async () => {
    const { boardId, a, b } = await pair();
    createSticky(a.doc, { x: 1, y: 1 });
    await converged([a, b]);
    await runInDurableObject(stubFor(boardId), (instance) => void instance.reload());
    createSticky(a.doc, { x: 50, y: 50 });
    await converged([a, b]);
    expect(snapshot(b.doc)).toHaveLength(2);
    expect(a.closeCode).toBeUndefined();
    expect(b.closeCode).toBeUndefined();
    await runInDurableObject(stubFor(boardId), (instance) => void instance.reload());
    const c = await WsClient.connect(boardId);
    await c.waitForSync();
    expect(snapshot(c.doc)).toHaveLength(2);
  });

  it('TC-26: a SQL error while reading puts the room in load-failed and closes clients with 4500', async () => {
    const boardId = newBoardId();
    const seed = await WsClient.connect(boardId);
    await seed.waitForSync();
    createSticky(seed.doc, { x: 1, y: 1 });
    await new Promise((r) => setTimeout(r, 50));
    seed.close();
    await runInDurableObject(stubFor(boardId), (instance, state) => {
      const failing = new BoardStore({
        transactionSync: state.storage.transactionSync.bind(state.storage),
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (/FROM snapshot_chunks/.test(query)) throw new Error('injected read failure');
            return state.storage.sql.exec(query, ...(bindings as never[]));
          },
        },
      } as unknown as DurableObjectStorage);
      const result = failing.load(new Y.Doc());
      expect(result).toMatchObject({ ok: false, reason: 'sql-error' });
      instance.store.load = (doc) => failing.load(doc);
      const errors = quiet();
      expect(instance.reload()).toBe('load-failed');
      errors.mockRestore();
    });
    const c = await WsClient.connect(boardId);
    await closed(c);
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});
