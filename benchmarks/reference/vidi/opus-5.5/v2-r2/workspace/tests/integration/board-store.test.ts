import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { moveObject, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import { type BoardFixture, largeBoard, randomBytes, retroBoard, truncated } from '../fixtures/boards';
import { failingStorage } from './storage-helpers';

/** Runs `fn` against the real SQLite storage of a fresh board's Durable Object. */
function withStorage<R>(fn: (storage: DurableObjectStorage) => R | Promise<R>): Promise<R> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_room, state) => fn(state.storage));
}

function count(storage: DurableObjectStorage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

function tables(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
    .toArray()
    .map((r) => r.name);
}

function meta(storage: DurableObjectStorage, key: string): string | undefined {
  return storage.sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0]?.value;
}

function maxSeq(storage: DurableObjectStorage): number {
  return storage.sql.exec<{ m: number }>('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m;
}

function freshLoad(storage: DurableObjectStorage) {
  const doc = new Y.Doc();
  const result = new BoardStore(storage).load(doc);
  return { doc, result };
}

function appendAll(store: BoardStore, board: BoardFixture): void {
  for (const row of board.rows) store.append(row.data);
}

/** Appends real move updates of the board's notes until the log holds `rows` rows. */
function fillLog(store: BoardStore, storage: DurableObjectStorage, board: BoardFixture, rows: number): void {
  const ids = snapshot(board.doc).map((n) => n.id);
  const onUpdate = (update: Uint8Array) => store.append(update);
  board.doc.on('update', onUpdate);
  for (let i = 0; count(storage, 'updates') < rows; i++) {
    const id = ids[i % ids.length]!;
    const note = snapshot(board.doc).find((n) => n.id === id)!;
    moveObject(board.doc, id, note.x + 1, note.y);
  }
  board.doc.off('update', onUpdate);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoardStore against real Durable Object SQLite (persist.board_store)', () => {
  it('TC-03: migrate + load on empty storage → tables exist, doc empty, schema version recorded', async () => {
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(tables(storage)).toEqual(
        expect.arrayContaining(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']),
      );
      expect(snapshot(doc)).toEqual([]);
      expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(new Y.Doc()));
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
      // Migrating again is harmless.
      store.migrate();
      expect(meta(storage, 'storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-25: opening a never-edited board creates only tables, no content rows', async () => {
    await withStorage((storage) => {
      new BoardStore(storage).migrate();
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it('TC-04: append one update → one row whose bytes column equals its length', async () => {
    const board = retroBoard(1);
    const update = Y.encodeStateAsUpdate(board.doc);
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      store.append(update);
      expect(count(storage, 'updates')).toBe(1);
      const row = storage.sql.exec<{ data: ArrayBuffer; bytes: number }>('SELECT data, bytes FROM updates').one();
      expect(row.bytes).toBe(update.length);
      expect(new Uint8Array(row.data)).toEqual(update);
    });
  });

  it('TC-05: a 25-note log reloads into a fresh doc identical to the original', async () => {
    const board = retroBoard();
    const original = snapshot(board.doc);
    expect(original).toHaveLength(25);
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board);
      const { doc, result } = freshLoad(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(original);
    });
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows the log compacts into a snapshot that reloads equal', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board);
      fillLog(store, storage, board, COMPACTION_UPDATE_COUNT - 1);
      // One row below the threshold: nothing happens.
      expect(store.compactIfNeeded(board.doc)).toBe(false);
      fillLog(store, storage, board, COMPACTION_UPDATE_COUNT);
      const original = snapshot(board.doc);
      const lastSeq = maxSeq(storage);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(count(storage, 'snapshot_chunks')).toBe(0);

      expect(store.compactIfNeeded(board.doc)).toBe(true);

      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(meta(storage, 'snapshot_through_seq')).toBe(String(lastSeq));
      const { doc, result } = freshLoad(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(original);
      // The log was reset: the next call is a no-op.
      expect(store.compactIfNeeded(board.doc)).toBe(false);
    });
  });

  it('TC-07: snapshot plus 3 later updates reloads with all of them; only seq > through_seq applied', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board);
      expect(store.compact(board.doc)).toBe(true);
      const through = Number(meta(storage, 'snapshot_through_seq'));
      const onUpdate = (u: Uint8Array) => store.append(u);
      board.doc.on('update', onUpdate);
      const ids = snapshot(board.doc).map((n) => n.id);
      moveObject(board.doc, ids[0]!, 1000, 1000);
      moveObject(board.doc, ids[1]!, -1000, 50);
      moveObject(board.doc, ids[2]!, 7, 7);
      board.doc.off('update', onUpdate);
      const seqs = storage.sql.exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq').toArray().map((r) => r.seq);
      expect(seqs).toHaveLength(3);
      for (const seq of seqs) expect(seq).toBeGreaterThan(through);

      // A stale row at seq = through_seq (already in the snapshot) must not be replayed.
      const stale = new Y.Doc();
      Y.applyUpdate(stale, Y.encodeStateAsUpdate(board.doc));
      let staleUpdate: Uint8Array = new Uint8Array();
      stale.on('update', (u: Uint8Array) => (staleUpdate = u));
      moveObject(stale, ids[3]!, 99_999, 99_999);
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', through, staleUpdate.slice().buffer, staleUpdate.length);

      const { doc, result } = freshLoad(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
      expect(snapshot(doc).find((n) => n.id === ids[3])?.x).not.toBe(99_999);
    });
  });

  it(`TC-08: a ${PERSIST_TESTED_NOTES}-note board compacts into chunked snapshots that reload equal`, async () => {
    const doc = largeBoard();
    const original = snapshot(doc);
    expect(original).toHaveLength(PERSIST_TESTED_NOTES);
    const encoded = Y.encodeStateAsUpdate(doc).length;
    // With the product chunk size, and with a small one that forces many chunks.
    for (const chunkSize of [SNAPSHOT_CHUNK_BYTES, 64 * 1024]) {
      await withStorage((storage) => {
        const store = new BoardStore(storage, { chunkBytes: chunkSize });
        store.migrate();
        store.append(Y.encodeStateAsUpdate(doc));
        expect(store.compact(doc)).toBe(true);
        const chunks = count(storage, 'snapshot_chunks');
        expect(chunks).toBe(Math.ceil(encoded / chunkSize));
        if (encoded > chunkSize) expect(chunks).toBeGreaterThan(1);
        const loaded = new Y.Doc();
        expect(new BoardStore(storage, { chunkBytes: chunkSize }).load(loaded)).toEqual({ ok: true, quarantined: 0 });
        expect(snapshot(loaded)).toEqual(original);
      });
    }
    console.info(`TC-08: ${PERSIST_TESTED_NOTES}-note board encodes to ${encoded} bytes`);
  });

  describe('TC-09: one damaged log row is quarantined and the rest of the board loads', () => {
    it.each([
      ['truncated', (data: Uint8Array) => truncated(data)],
      ['random bytes', (data: Uint8Array) => randomBytes(data.length)],
    ])('%s', async (_label, damage) => {
      const board = retroBoard();
      const damagedNote = board.rows[6]!.noteId;
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      await withStorage((storage) => {
        const store = new BoardStore(storage);
        store.migrate();
        appendAll(store, board);
        const rowsBefore = count(storage, 'updates');
        const seq7 = storage.sql.exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq LIMIT 1 OFFSET 6').one().seq;
        const damaged = damage(board.rows[6]!.data);
        storage.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged.slice().buffer, seq7);

        const { doc, result } = freshLoad(storage);

        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(count(storage, 'updates')).toBe(rowsBefore - 1);
        const q = storage.sql
          .exec<{ seq: number; data: ArrayBuffer; error: string; quarantined_at: number }>('SELECT * FROM quarantined_updates')
          .toArray();
        expect(q).toHaveLength(1);
        expect(q[0]!.seq).toBe(seq7);
        expect(new Uint8Array(q[0]!.data)).toEqual(damaged);
        expect(q[0]!.error.length).toBeGreaterThan(0);
        expect(q[0]!.quarantined_at).toBeGreaterThan(0);
        // Every other note is intact; only the damaged change is missing.
        const expected = snapshot(board.doc).filter((n) => n.id !== damagedNote);
        const loaded = snapshot(doc).filter((n) => n.id !== damagedNote);
        expect(loaded).toEqual(expected);
        expect(loaded).toHaveLength(24);
        // A second load no longer sees the damaged row.
        expect(freshLoad(storage).result).toEqual({ ok: true, quarantined: 0 });
      });
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('board-update-quarantined'));
    });
  });

  it('TC-10: a damaged snapshot → snapshot-unreadable; nothing deleted or quarantined', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board);
      expect(store.compact(board.doc)).toBe(true);
      store.append(board.rows[0]!.data);
      const chunk = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
      for (const damaged of [truncated(new Uint8Array(chunk.data)), randomBytes(chunk.data.byteLength)]) {
        storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged.slice().buffer);
        const before = { updates: count(storage, 'updates'), chunks: count(storage, 'snapshot_chunks') };

        const { result } = freshLoad(storage);

        expect(result).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
        expect(result.ok === false && result.error.length > 0).toBe(true);
        expect(count(storage, 'updates')).toBe(before.updates);
        expect(count(storage, 'snapshot_chunks')).toBe(before.chunks);
        expect(count(storage, 'quarantined_updates')).toBe(0);
      }
    });
  });

  it('TC-11: a compaction that fails after deleting the old chunks rolls back; snapshot and log intact', async () => {
    const board = retroBoard();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await withStorage((storage) => {
      const real = new BoardStore(storage);
      real.migrate();
      appendAll(real, board);
      expect(real.compact(board.doc)).toBe(true);
      const onUpdate = (u: Uint8Array) => real.append(u);
      board.doc.on('update', onUpdate);
      moveObject(board.doc, snapshot(board.doc)[0]!.id, 555, 555);
      board.doc.off('update', onUpdate);
      const chunksBefore = storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray();
      const logBefore = storage.sql.exec('SELECT seq, data, bytes FROM updates ORDER BY seq').toArray();
      const throughBefore = meta(storage, 'snapshot_through_seq');

      // The failure hits the statement right after DELETE FROM snapshot_chunks.
      const failing = new BoardStore(failingStorage(storage, /^INSERT INTO snapshot_chunks/));
      expect(failing.compact(board.doc)).toBe(false);

      expect(storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx').toArray()).toEqual(chunksBefore);
      expect(storage.sql.exec('SELECT seq, data, bytes FROM updates ORDER BY seq').toArray()).toEqual(logBefore);
      expect(meta(storage, 'snapshot_through_seq')).toBe(throughBefore);
      const { doc, result } = freshLoad(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(snapshot(board.doc));
    });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('board-compaction-failed'));
  });

  it('compactIfNeeded never throws, even when SQL fails at the threshold', async () => {
    const board = retroBoard();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await withStorage((storage) => {
      const store = new BoardStore(failingStorage(storage, /^(DELETE FROM|INSERT INTO) snapshot_chunks/));
      store.migrate();
      fillLog(store, storage, board, COMPACTION_UPDATE_COUNT);
      expect(() => store.compactIfNeeded(board.doc)).not.toThrow();
      expect(store.compactIfNeeded(board.doc)).toBe(false);
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
    });
  });

  it('TC-26 (store): a SQL error while reading → sql-error, never an empty board', async () => {
    const board = retroBoard();
    await withStorage((storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      appendAll(store, board);
      const result = new BoardStore(failingStorage(storage, /^SELECT seq, data FROM updates/)).load(new Y.Doc());
      expect(result).toMatchObject({ ok: false, reason: 'sql-error' });
    });
  });
});
