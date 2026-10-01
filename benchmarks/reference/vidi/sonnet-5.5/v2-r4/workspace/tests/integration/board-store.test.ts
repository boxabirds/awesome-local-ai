import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText, moveObject, snapshot } from '../../src/shared/board-model';
import { COMPACTION_UPDATE_COUNT, PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION } from '../../src/shared/config';
import { BoardStore, type StoreStorage } from '../../src/worker/board-store';
import { boardJson, largeBoard, randomBytes, retroBoard25, truncated, type BuiltBoard } from '../fixtures/boards';
import { WsClient } from './ws-client';

/** Runs `fn` inside a fresh board's Durable Object with a store over its real SQLite storage. */
function inBoard<R>(fn: (store: BoardStore, state: DurableObjectState, storage: StoreStorage) => R | Promise<R>): Promise<R> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_room, state) => {
    const storage = state.storage as unknown as StoreStorage;
    return fn(new BoardStore(storage), state, storage);
  });
}

const rows = (state: DurableObjectState, sql: string) => state.storage.sql.exec(sql).toArray();
const count = (state: DurableObjectState, table: string) => Number(rows(state, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);

function appendAll(store: BoardStore, b: BuiltBoard, upTo = b.updates.length): void {
  for (const u of b.updates.slice(0, upTo)) store.append(u);
}

/** Extends a built board with move updates until it has at least `n` updates. */
function padUpdates(b: BuiltBoard, n: number): void {
  const id = snapshot(b.doc)[0].id;
  for (let i = 0; b.updates.length < n; i++) moveObject(b.doc, id, i, i);
}

function reload(store: BoardStore): { doc: Y.Doc; result: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  return { doc, result: store.load(doc) };
}

describe('BoardStore', () => {
  it('TC-03: empty board — migrate + load gives tables, an empty doc and the schema version', async () => {
    await inBoard((store, state) => {
      store.migrate();
      const { doc, result } = reload(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(0);
      const tables = rows(state, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
      for (const t of ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']) expect(tables).toContain(t);
      expect(rows(state, "SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")[0].value).toBe(
        String(STORAGE_SCHEMA_VERSION),
      );
    });
  });

  it('TC-04: append one update → one row whose bytes column equals its length', async () => {
    await inBoard((store, state) => {
      store.migrate();
      const doc = new Y.Doc();
      const updates: Uint8Array[] = [];
      doc.on('update', (u: Uint8Array) => updates.push(u));
      createSticky(doc, { x: 1, y: 2 });
      expect(count(state, 'updates')).toBe(0);
      store.append(updates[0]);
      const r = rows(state, 'SELECT bytes, length(data) AS len FROM updates');
      expect(r).toHaveLength(1);
      expect(r[0].bytes).toBe(updates[0].length);
      expect(r[0].len).toBe(updates[0].length);
    });
  });

  it('TC-05: log only, 25 notes — load into a fresh doc equals the original', async () => {
    await inBoard((store) => {
      const b = retroBoard25();
      store.migrate();
      appendAll(store, b);
      const { doc, result } = reload(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(25);
      expect(boardJson(doc)).toBe(boardJson(b.doc));
    });
  });

  it('TC-06: compaction at COMPACTION_UPDATE_COUNT rows empties the log into chunks', async () => {
    await inBoard((store, state) => {
      const b = retroBoard25();
      padUpdates(b, COMPACTION_UPDATE_COUNT);
      store.migrate();
      appendAll(store, b, COMPACTION_UPDATE_COUNT - 1);
      expect(store.compactIfNeeded(b.doc)).toBe(false);
      expect(count(state, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
      store.append(b.updates[COMPACTION_UPDATE_COUNT - 1]);
      expect(count(state, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      const maxSeq = Number(rows(state, 'SELECT MAX(seq) AS m FROM updates')[0].m);

      expect(store.compactIfNeeded(b.doc)).toBe(true);
      expect(count(state, 'updates')).toBe(0);
      expect(count(state, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(rows(state, "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")[0].value).toBe(String(maxSeq));
      expect(boardJson(reload(store).doc)).toBe(boardJson(b.doc));
    });
  });

  it('TC-07: snapshot + log — updates after compaction are replayed, rows at or below through_seq are not', async () => {
    await inBoard((store, state) => {
      const b = retroBoard25();
      store.migrate();
      appendAll(store, b);
      expect(store.compact(b.doc)).toBe(true);
      const through = Number(rows(state, "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")[0].value);
      // A stale row at or below through_seq must be ignored: put an update there that would visibly change the board.
      const stale = new Y.Doc();
      createSticky(stale, { x: 9, y: 9 });
      state.storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', through - 1, Y.encodeStateAsUpdate(stale), 1);

      const before = b.updates.length;
      const id = snapshot(b.doc)[2].id;
      moveObject(b.doc, id, 5000, 5000);
      getStickyText(b.doc, id)!.insert(0, 'later ');
      createSticky(b.doc, { x: 40, y: 40 });
      expect(b.updates.length - before).toBe(3);
      for (const u of b.updates.slice(before)) store.append(u);

      const { doc, result } = reload(store);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(26);
      expect(boardJson(doc)).toBe(boardJson(b.doc));
    });
  });

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into several chunks and reloads equal', async () => {
    await inBoard((store, state) => {
      const b = largeBoard(PERSIST_TESTED_NOTES);
      store.migrate();
      appendAll(store, b);
      const encoded = Y.encodeStateAsUpdate(b.doc);
      expect(store.compact(b.doc)).toBe(true);
      const chunks = count(state, 'snapshot_chunks');
      if (encoded.length > SNAPSHOT_CHUNK_BYTES) expect(chunks).toBeGreaterThan(1);
      expect(chunks).toBe(Math.ceil(encoded.length / SNAPSHOT_CHUNK_BYTES));
      const maxRow = Number(rows(state, 'SELECT MAX(length(data)) AS m FROM snapshot_chunks')[0].m);
      expect(maxRow).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      const { doc, result } = reload(store);
      expect(result.ok).toBe(true);
      expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
      expect(boardJson(doc)).toBe(boardJson(b.doc));
    });
  });

  describe('TC-09: one damaged log row is quarantined', () => {
    const damage: [string, (d: Uint8Array) => Uint8Array][] = [
      ['truncated', truncated],
      ['random bytes of the same length', (d) => randomBytes(d.length)],
    ];
    it.each(damage)('%s', async (_name, make) => {
      await inBoard((store, state) => {
        const b = retroBoard25();
        // The 7th stored change comes from another person's page; it is the one that gets damaged.
        const other = new Y.Doc();
        const otherUpdates: Uint8Array[] = [];
        other.on('update', (u: Uint8Array) => otherUpdates.push(u));
        createSticky(other, { x: 3, y: 3 });
        store.migrate();
        appendAll(store, b, 6);
        store.append(otherUpdates[0]);
        for (const u of b.updates.slice(6)) store.append(u);
        const total = count(state, 'updates');
        const victim = Number(rows(state, 'SELECT seq FROM updates ORDER BY seq')[6].seq);
        const original = new Uint8Array(rows(state, `SELECT data FROM updates WHERE seq = ${victim}`)[0].data as ArrayBuffer);
        state.storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', make(original), victim);

        const { doc, result } = reload(store);
        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(count(state, 'updates')).toBe(total - 1);
        const q = rows(state, 'SELECT seq, error FROM quarantined_updates');
        expect(q).toHaveLength(1);
        expect(Number(q[0].seq)).toBe(victim);
        expect(String(q[0].error).length).toBeGreaterThan(0);
        expect(snapshot(doc)).toHaveLength(25);
        expect(boardJson(doc)).toBe(boardJson(b.doc));
      });
    });
  });

  it('TC-10: a damaged snapshot is reported and nothing is deleted or quarantined', async () => {
    await inBoard((store, state) => {
      const b = retroBoard25();
      store.migrate();
      appendAll(store, b);
      store.compact(b.doc);
      store.append(b.updates[0]); // a log row after the snapshot
      const chunk = new Uint8Array(rows(state, 'SELECT data FROM snapshot_chunks WHERE idx = 0')[0].data as ArrayBuffer);
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(chunk));
      const before = { chunks: count(state, 'snapshot_chunks'), log: count(state, 'updates') };

      const { result } = reload(store);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('snapshot-unreadable');
        expect(result.error.length).toBeGreaterThan(0);
      }
      expect({ chunks: count(state, 'snapshot_chunks'), log: count(state, 'updates') }).toEqual(before);
      expect(count(state, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-11: a failure inside compaction rolls back; previous chunks and log are unchanged', async () => {
    await inBoard((store, state, storage) => {
      const b = retroBoard25();
      store.migrate();
      appendAll(store, b);
      expect(store.compact(b.doc)).toBe(true);
      const id = snapshot(b.doc)[0].id;
      moveObject(b.doc, id, 1, 1);
      store.append(b.updates[b.updates.length - 1]);

      const chunksBefore = JSON.stringify(rows(state, 'SELECT idx, hex(data) AS h FROM snapshot_chunks'));
      const logBefore = JSON.stringify(rows(state, 'SELECT seq, hex(data) AS h FROM updates'));
      const metaBefore = JSON.stringify(rows(state, 'SELECT key, value FROM storage_meta ORDER BY key'));

      // A store whose statements fail once the old chunks have been deleted.
      let deleted = false;
      const failing: StoreStorage = {
        transactionSync: (fn) => storage.transactionSync(fn),
        sql: {
          exec(query: string, ...bindings: unknown[]) {
            if (deleted && /INSERT INTO snapshot_chunks/.test(query)) throw new Error('injected failure');
            const cursor = storage.sql.exec(query, ...bindings);
            if (/DELETE FROM snapshot_chunks/.test(query)) deleted = true;
            return cursor;
          },
        },
      };
      const failingStore = new BoardStore(failing);
      expect(failingStore.compact(b.doc)).toBe(false);
      expect(deleted).toBe(true);

      expect(JSON.stringify(rows(state, 'SELECT idx, hex(data) AS h FROM snapshot_chunks'))).toBe(chunksBefore);
      expect(JSON.stringify(rows(state, 'SELECT seq, hex(data) AS h FROM updates'))).toBe(logBefore);
      expect(JSON.stringify(rows(state, 'SELECT key, value FROM storage_meta ORDER BY key'))).toBe(metaBefore);
      expect(boardJson(reload(store).doc)).toBe(boardJson(b.doc));
    });
  });

  it('TC-25: opening a never-edited board creates the tables but no rows', async () => {
    const id = newBoardId();
    const c = await WsClient.connect(id);
    expect(snapshot(c.doc)).toHaveLength(0);
    c.close();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    await runInDurableObject(stub, (_room, state) => {
      expect(count(state, 'updates')).toBe(0);
      expect(count(state, 'snapshot_chunks')).toBe(0);
    });
  });
});
