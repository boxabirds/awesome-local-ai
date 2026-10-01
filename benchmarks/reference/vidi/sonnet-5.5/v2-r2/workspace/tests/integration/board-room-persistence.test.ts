import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { randomBytesLike, retroBoard } from '../fixtures/boards';
import { inRoom, rowCount, snap } from './helpers/room';
import { WsClient, connectAll, converged, eventually } from './helpers/ws-client';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real client doc holding the 25-note retro board, synced to the room. */
async function seedRetro(boardId: string): Promise<WsClient> {
  const client = await WsClient.connect(boardId, new Y.Doc());
  await client.waitForSync();
  retroBoard(client.doc);
  // Wait until the room holds (and therefore has stored) everything the client sent.
  const expected = snap(client.doc);
  for (let i = 0; i < 200; i++) {
    if (await inRoom(boardId, (room) => !!room.doc && snap(room.doc) === expected)) return client;
    await pause(25);
  }
  throw new Error('room never caught up with the seeding client');
}

function loadFromStorage(storage: DurableObjectStorage): Y.Doc {
  const doc = new Y.Doc();
  const result = new BoardStore(storage).load(doc);
  expect(result.ok).toBe(true);
  return doc;
}

describe('persistent BoardRoom', () => {
  it('TC-12: the update row exists by the time another client sees the change', async () => {
    const id = newBoardId();
    const [a, b] = await connectAll(id, 2);
    let rowsWhenSeen = -1;
    b.doc.on('update', async () => { /* observed below */ });
    const seen = new Promise<void>((resolve) => {
      b.doc.getMap('objects').observeDeep(() => {
        void inRoom(id, (_r, s) => { rowsWhenSeen = rowCount(s.storage.sql, 'updates'); }).then(() => resolve());
      });
    });
    const noteId = createSticky(a.doc, { x: 10, y: 20 });
    await seen;
    expect(rowsWhenSeen).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    await inRoom(id, (_r, s) => {
      const doc = loadFromStorage(s.storage);
      expect(snapshot(doc).map((n) => n.id)).toEqual([noteId]);
    });
  });

  it('TC-13: a new room instance over the same storage serves the identical board', async () => {
    const id = newBoardId();
    const a = await seedRetro(id);
    const expected = snap(a.doc);
    a.close();
    await pause(50);
    await inRoom(id, async (room, state) => {
      const fresh = new BoardRoom(state, (room as unknown as { env: never }).env);
      await fresh.ready;
      expect(fresh.state).toBe('ready');
      expect(snapshot(fresh.doc!)).toHaveLength(25);
      expect(snap(fresh.doc!)).toBe(expected);
    });
    const b = await WsClient.connect(id);
    await b.waitForSync();
    expect(snap(b.doc)).toBe(expected);
  });

  it('TC-14: a failed append is not broadcast; both close 1011; reconnect saves and delivers it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = newBoardId();
    const [a, b] = await connectAll(id, 2);
    await inRoom(id, (room) => {
      const original = room.store.append.bind(room.store);
      let first = true;
      room.store.append = (u) => {
        if (first) { first = false; throw new Error('disk full'); }
        original(u);
      };
    });
    const bBefore = b.updatesReceived;
    const noteId = createSticky(a.doc, { x: 5, y: 5 });
    await eventually(() => a.closeCode !== null && b.closeCode !== null);
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.updatesReceived).toBe(bBefore);
    expect(b.snapshot()).toHaveLength(0);
    await inRoom(id, (_r, s) => expect(rowCount(s.storage.sql, 'updates')).toBe(0));

    // A reconnects still holding the change; B reconnects with its own doc.
    const a2 = await WsClient.connect(id, a.doc);
    const b2 = await WsClient.connect(id, b.doc);
    await eventually(() => b2.snapshot().some((n) => n.id === noteId));
    await inRoom(id, (_r, s) => {
      expect(snapshot(loadFromStorage(s.storage)).map((n) => n.id)).toEqual([noteId]);
    });
    a2.close();
    b2.close();
  });

  it('TC-15: a corrupt snapshot closes clients 4500 and stores nothing they send', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = newBoardId();
    const seed = await seedRetro(id);
    seed.close();
    await inRoom(id, (room, state) => {
      room.store.compactNow(room.doc!);
      const sql = state.storage.sql;
      const chunk0 = new Uint8Array(sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(chunk0));
      room.load();
      expect(room.state).toBe('load-failed');
    });
    const rows = await inRoom(id, (_r, s) => rowCount(s.storage.sql, 'updates'));

    const client = await WsClient.connect(id, new Y.Doc());
    await eventually(() => client.closeCode !== null);
    expect(client.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(client.synced).toBe(false);
    expect(() => createSticky(client.doc, { x: 0, y: 0 })).not.toThrow();
    await pause(50);
    await inRoom(id, (room, s) => {
      expect(rowCount(s.storage.sql, 'updates')).toBe(rows);
      expect(room.doc).toBeNull();
    });
  });

  it('TC-16: retry only after LOAD_RETRY_MIN_INTERVAL_MS; a repaired board then loads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = newBoardId();
    const seed = await seedRetro(id);
    const expected = snap(seed.doc);
    seed.close();
    let chunk0!: Uint8Array;
    await inRoom(id, (room, state) => {
      room.store.compactNow(room.doc!);
      const sql = state.storage.sql;
      chunk0 = new Uint8Array(sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').one().data as ArrayBuffer);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', randomBytesLike(chunk0));
      room.load();
    });
    let loadAttempts = 0;
    await inRoom(id, (room) => {
      const original = room.store.load.bind(room.store);
      room.store.load = (doc) => { loadAttempts++; return original(doc); };
    });

    const early = await WsClient.connect(id);
    await eventually(() => early.closeCode !== null);
    expect(early.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loadAttempts).toBe(0);

    await inRoom(id, (_room, state) => {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', chunk0);
    });
    // Still within the interval: no reload even though storage is repaired.
    const stillEarly = await WsClient.connect(id);
    await eventually(() => stillEarly.closeCode !== null);
    expect(stillEarly.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loadAttempts).toBe(0);

    await inRoom(id, (room) => {
      (room as unknown as { failedAt: number }).failedAt -= LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const late = await WsClient.connect(id);
    await late.waitForSync();
    expect(loadAttempts).toBe(1);
    expect(late.closeCode).toBeNull();
    expect(snap(late.doc)).toBe(expected);
  });

  it('TC-17: a garbage update closes 1003 and is not stored', async () => {
    const id = newBoardId();
    const [a] = await connectAll(id, 1);
    // sync step 2 whose payload is not a Yjs update
    a.sendRaw(new Uint8Array([0, 2, 6, 255, 255, 255, 1, 2, 3]));
    await eventually(() => a.closeCode !== null);
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    await inRoom(id, (_r, s) => expect(rowCount(s.storage.sql, 'updates')).toBe(0));
  });

  it('TC-18: after the object is reconstructed, earlier sockets still receive messages and broadcasts', async () => {
    const id = newBoardId();
    const [a, b] = await connectAll(id, 2);
    createSticky(a.doc, { x: 1, y: 1 });
    await converged([a, b]);
    await inRoom(id, async (room, state) => {
      // A woken object: new instance over the same ctx; sockets come from ctx.getWebSockets().
      const woken = new BoardRoom(state, (room as unknown as { env: never }).env);
      await woken.ready;
      expect(state.getWebSockets()).toHaveLength(2);
      expect(snapshot(woken.doc!)).toHaveLength(1);
      (globalThis as unknown as { __woken: BoardRoom }).__woken = woken;
    });
    // Route a real message through the reconstructed instance.
    await inRoom(id, (room, state) => {
      const woken = (globalThis as unknown as { __woken: BoardRoom }).__woken;
      const [ws] = state.getWebSockets();
      expect(ws).toBeDefined();
      const aDoc = new Y.Doc();
      Y.applyUpdate(aDoc, Y.encodeStateAsUpdate(a.doc));
      createSticky(aDoc, { x: 50, y: 50 });
      const update = Y.encodeStateAsUpdate(aDoc, Y.encodeStateVector(woken.doc!));
      const frame = new Uint8Array([0, 2, ...varUint(update.length), ...update]);
      woken.webSocketMessage(ws, frame.buffer);
      void room;
    });
    await eventually(() => a.snapshot().length === 2 || b.snapshot().length === 2);
  });

  it('TC-26: a SQL read error on load puts the room in load-failed and closes clients 4500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = newBoardId();
    const seed = await seedRetro(id);
    seed.close();
    await inRoom(id, (room, state) => {
      const throwingSelects = {
        transactionSync: state.storage.transactionSync.bind(state.storage),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (query.trim().startsWith('SELECT')) throw new Error('injected read error');
            return state.storage.sql.exec(query, ...bindings);
          },
        },
      } as unknown as DurableObjectStorage;
      const result = new BoardStore(throwingSelects).load(new Y.Doc());
      expect(result).toMatchObject({ ok: false, reason: 'sql-error' });
      room.store = new BoardStore(throwingSelects);
      room.load();
      expect(room.state).toBe('load-failed');
    });
    const client = await WsClient.connect(id);
    await eventually(() => client.closeCode !== null);
    expect(client.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(client.synced).toBe(false);
  });

  it('a quarantined row does not stop the room from serving the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = newBoardId();
    const seed = await seedRetro(id);
    seed.close();
    await inRoom(id, (room, state) => {
      const sql = state.storage.sql;
      const seq = sql.exec('SELECT seq FROM updates ORDER BY seq LIMIT 1 OFFSET 5').one().seq as number;
      sql.exec('UPDATE updates SET data = ? WHERE seq = ?', new Uint8Array([1, 2, 3, 4, 5]), seq);
      room.load();
      expect(room.state).toBe('ready');
      expect(rowCount(sql, 'quarantined_updates')).toBe(1);
    });
    const client = await WsClient.connect(id);
    await client.waitForSync();
    expect(client.snapshot().length).toBeGreaterThan(0);
    void getStickyText;
  });
});

function varUint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}
