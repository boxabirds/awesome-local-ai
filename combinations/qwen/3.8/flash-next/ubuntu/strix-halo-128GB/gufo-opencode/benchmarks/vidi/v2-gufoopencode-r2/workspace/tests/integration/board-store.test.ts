// Task 3: BoardStore against real Durable Object SQLite (TC-03 to TC-11,
// TC-25). Every store operation runs inside runInDurableObject so it uses
// the real `ctx.storage`; closures receive data through arguments (they are
// serialized) and return cloneable results.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  moveObject,
  snapshot,
} from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import {
  generateLargeBoard,
  generateRetroBoard,
  randomBytesLike,
  truncatedBytes,
} from '../fixtures/boards';

function boardStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function tableNames(state: DurableObjectState): string[] {
  return state.storage.sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((row) => String(row.name));
}

describe('BoardStore on real DO SQLite', () => {
  it('TC-03: empty board migrate + load keeps the doc empty and stores the schema version', async () => {
    const out = await runInDurableObject(boardStub(newBoardId()), (_obj, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      const result = store.load(doc);
      const version = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'storage_schema_version'")
        .toArray()[0]?.value;
      return {
        result,
        tables: tableNames(state),
        version: version ?? null,
        noteCount: snapshot(doc).length,
      };
    });
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.tables).toEqual(
      expect.arrayContaining(['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates']),
    );
    expect(out.version).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(out.noteCount).toBe(0);
  });

  it('TC-25: migrate on a never-edited board writes no update or snapshot rows', async () => {
    const out = await runInDurableObject(boardStub(newBoardId()), (_obj, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const updates = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c;
      const chunks = state.storage.sql
        .exec('SELECT COUNT(*) AS c FROM snapshot_chunks')
        .toArray()[0].c;
      return { updates, chunks };
    });
    expect(out).toEqual({ updates: 0, chunks: 0 });
  });

  it('TC-04: appending one update writes one row whose bytes column matches', async () => {
    const retro = generateRetroBoard();
    const rows = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        store.append(retro.updates[0]);
        return state.storage.sql.exec('SELECT seq, bytes FROM updates ORDER BY seq').toArray();
      },
    );
    expect(rows).toEqual([{ seq: 1, bytes: retro.updates[0].byteLength }]);
  });

  it('TC-05: a 25-note log-only board reloads into a fresh doc with an equal snapshot', async () => {
    const retro = generateRetroBoard();
    const expected = JSON.stringify(retro.board);
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of retro.updates) store.append(update);
        const doc = new Y.Doc();
        const result = store.load(doc);
        return { result, board: JSON.stringify(snapshot(doc)) };
      },
    );
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.board).toBe(expected);
  });

  it('TC-06: compaction at exactly COMPACTION_UPDATE_COUNT rows replaces the log', async () => {
    const out = await runInDurableObject(boardStub(newBoardId()), (_obj, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 100, y: 100 });
      if (typeof id !== 'string') throw new Error('createSticky failed');
      const updates: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) updates.push(update.slice());
      });
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) moveObject(doc, id, 100 + i, 100);
      const below = updates.slice(0, COMPACTION_UPDATE_COUNT - 1);
      for (const update of below) store.append(update);
      const compactedBelow = store.compactIfNeeded(doc);
      store.append(updates[COMPACTION_UPDATE_COUNT - 1]);
      const compacted = store.compactIfNeeded(doc);
      const rows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c;
      const chunks = state.storage.sql
        .exec('SELECT COUNT(*) AS c FROM snapshot_chunks')
        .toArray()[0].c;
      const through = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .toArray()[0]?.value;
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        compactedBelow,
        compacted,
        rows,
        chunks,
        through: through ?? null,
        result,
        loaded: JSON.stringify(snapshot(fresh)),
        original: JSON.stringify(snapshot(doc)),
      };
    });
    expect(out.compactedBelow).toBe(false);
    expect(out.compacted).toBe(true);
    expect(out.rows).toBe(0);
    expect(out.chunks).toBeGreaterThanOrEqual(1);
    expect(out.through).toBe(String(COMPACTION_UPDATE_COUNT));
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.loaded).toBe(out.original);
  });

  it('TC-07: updates appended after compaction reload on top of the snapshot', async () => {
    const out = await runInDurableObject(boardStub(newBoardId()), (_obj, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      if (typeof id !== 'string') throw new Error('createSticky failed');
      const updates: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) updates.push(update.slice());
      });
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) moveObject(doc, id, i, i);
      for (const update of updates) store.append(update);
      expect(store.compactIfNeeded(doc)).toBe(true);
      const through = state.storage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .toArray()[0]?.value;
      // Three more updates after the snapshot: these must be the only rows
      // applied on reload (seq > snapshot_through_seq).
      for (let i = 0; i < 3; i++) moveObject(doc, id, 700 + i, 800 + i);
      const after = updates.slice(-3);
      for (const update of after) store.append(update);
      const rows = state.storage.sql.exec('SELECT seq FROM updates ORDER BY seq').toArray();
      const fresh = new Y.Doc();
      const result = store.load(fresh);
      return {
        through: through ?? null,
        rows,
        result,
        loaded: JSON.stringify(snapshot(fresh)),
        original: JSON.stringify(snapshot(doc)),
      };
    });
    expect(out.rows).toEqual([{ seq: 501 }, { seq: 502 }, { seq: 503 }]);
    expect(Number(out.through)).toBeLessThan(501);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.loaded).toBe(out.original);
    // Final position proves the three post-snapshot updates were applied.
    const board = JSON.parse(out.loaded) as { x: number; y: number }[];
    expect(board[0]).toMatchObject({ x: 702, y: 802 });
  });

  it('TC-08: a PERSIST_TESTED_NOTES board compacts into multiple chunks and reloads equal', async () => {
    const big = generateLargeBoard();
    const expected = JSON.stringify(big.board);
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of big.updates) store.append(update);
        const source = new Y.Doc();
        for (const update of big.updates) Y.applyUpdate(source, update);
        const encodedSize = Y.encodeStateAsUpdate(source).byteLength;
        const compacted = store.compactIfNeeded(source);
        const chunkRows = state.storage.sql
          .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
          .toArray();
        const joinedBytes = chunkRows.reduce(
          (sum, row) => sum + (row.data as ArrayBuffer).byteLength,
          0,
        );
        const fresh = new Y.Doc();
        const result = store.load(fresh);
        return {
          encodedSize,
          compacted,
          chunkCount: chunkRows.length,
          joinedBytes,
          result,
          board: JSON.stringify(snapshot(fresh)),
        };
      },
    );
    expect(out.compacted).toBe(true);
    expect(out.encodedSize).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    if (out.encodedSize > SNAPSHOT_CHUNK_BYTES) expect(out.chunkCount).toBeGreaterThan(1);
    expect(out.joinedBytes).toBe(out.encodedSize);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.board).toBe(expected);
  }, 120_000);

  it('TC-09: one damaged log row is quarantined and the rest of the board loads', async () => {
    const retro = generateRetroBoard();
    const last = retro.updates.length - 1;
    const damaged = truncatedBytes(retro.updates[last]); // the final styling update
    expect(() => Y.applyUpdate(new Y.Doc(), damaged)).toThrow();
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of retro.updates) store.append(update);
        const rowsBefore = state.storage.sql
          .exec('SELECT COUNT(*) AS c FROM updates')
          .toArray()[0].c as number;
        const lastSeq = state.storage.sql
          .exec('SELECT MAX(seq) AS m FROM updates')
          .toArray()[0].m as number;
        state.storage.sql.exec(
          'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
          damaged,
          damaged.byteLength,
          lastSeq,
        );
        const reader = new BoardStore(state.storage);
        const doc = new Y.Doc();
        const result = reader.load(doc);
        const rowsAfter = state.storage.sql
          .exec('SELECT COUNT(*) AS c FROM updates')
          .toArray()[0].c as number;
        const quarantined = state.storage.sql
          .exec('SELECT seq, error FROM quarantined_updates')
          .toArray();
        // A second load must not quarantine anything again.
        const doc2 = new Y.Doc();
        const second = new BoardStore(state.storage).load(doc2);
        return {
          rowsBefore,
          rowsAfter,
          result,
          quarantined,
          second,
          lastSeq,
          noteCount: snapshot(doc).length,
          ids: snapshot(doc).map((note) => note.id),
        };
      },
    );
    expect(out.result).toEqual({ ok: true, quarantined: 1 });
    expect(out.rowsAfter).toBe(out.rowsBefore - 1);
    expect(out.quarantined).toHaveLength(1);
    expect(out.quarantined[0].seq).toBe(out.lastSeq);
    expect(String(out.quarantined[0].error).length).toBeGreaterThan(0);
    expect(out.second).toEqual({ ok: true, quarantined: 0 });
    expect(out.noteCount).toBe(25);
    const expectedIds = new Set(retro.board.map((note) => note.id));
    expect(out.ids.every((id) => expectedIds.has(id))).toBe(true);
  });

  it('TC-10: a damaged snapshot reports snapshot-unreadable and deletes nothing', async () => {
    const retro = generateRetroBoard();
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of retro.updates) store.append(update);
        const source = new Y.Doc();
        for (const update of retro.updates) Y.applyUpdate(source, update);
        expect(store.compact(source)).toBe(true);
        const before = {
          chunks: state.storage.sql
            .exec('SELECT COUNT(*) AS c FROM snapshot_chunks')
            .toArray()[0].c,
          updates: state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c,
        };
        const chunk0 = state.storage.sql
          .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .toArray()[0].data as ArrayBuffer;
        const damaged = truncatedBytes(new Uint8Array(chunk0));
        state.storage.sql.exec(
          'UPDATE snapshot_chunks SET data = ? WHERE idx = 0',
          damaged,
        );
        const doc = new Y.Doc();
        const result = new BoardStore(state.storage).load(doc);
        const after = {
          chunks: state.storage.sql
            .exec('SELECT COUNT(*) AS c FROM snapshot_chunks')
            .toArray()[0].c,
          updates: state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c,
          quarantined: state.storage.sql
            .exec('SELECT COUNT(*) AS c FROM quarantined_updates')
            .toArray()[0].c,
        };
        return { before, after, result, noteCount: snapshot(doc).length };
      },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.reason).toBe('snapshot-unreadable');
    expect(out.after.chunks).toBe(out.before.chunks);
    expect(out.after.updates).toBe(out.before.updates);
    expect(out.after.quarantined).toBe(0);
    expect(out.noteCount).toBe(0);
  });

  it('TC-11: a compaction failure rolls back: previous snapshot and log stay intact', async () => {
    const retro = generateRetroBoard();
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of retro.updates) store.append(update);
        const source = new Y.Doc();
        for (const update of retro.updates) Y.applyUpdate(source, update);
        expect(store.compact(source)).toBe(true);
        const goodChunk = state.storage.sql
          .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .toArray()[0].data as ArrayBuffer;
        // Append more updates (applied to the same doc, as the room does) so
        // a second compaction has work to do, then inject a throw after the
        // first chunk insert inside the transaction.
        const id = snapshot(source)[0].id;
        const extra: Uint8Array[] = [];
        source.on('update', (u: Uint8Array) => extra.push(u.slice()));
        moveObject(source, id, 1111, 2222);
        for (const update of extra) store.append(update);
        const authoritative = JSON.stringify(snapshot(source));

        const original = store.insertSnapshotChunk.bind(store);
        store.insertSnapshotChunk = (idx: number, data: Uint8Array) => {
          original(idx, data);
          throw new Error('injected compaction failure');
        };
        const failed = store.compact(source);
        delete (store as Partial<BoardStore>).insertSnapshotChunk;

        const after = {
          chunks: state.storage.sql
            .exec('SELECT COUNT(*) AS c FROM snapshot_chunks')
            .toArray()[0].c,
          updates: state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c,
        };
        const chunkStillGood = state.storage.sql
          .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
          .toArray()[0].data as ArrayBuffer;
        // Recovery: compaction works again once the injected failure is gone.
        const recovered = store.compact(source);
        const fresh = new Y.Doc();
        const result = store.load(fresh);
        return {
          failed,
          after,
          chunkStillGoodBytes: new Uint8Array(chunkStillGood).slice(0, 32).join(','),
          goodChunkBytes: new Uint8Array(goodChunk).slice(0, 32).join(','),
          recovered,
          result,
          board: JSON.stringify(snapshot(fresh)),
          authoritative,
        };
      },
    );
    expect(out.failed).toBe(false);
    expect(out.after.chunks).toBe(1);
    expect(out.after.updates).toBe(1); // the injected-failure transaction rolled back
    expect(out.chunkStillGoodBytes).toBe(out.goodChunkBytes);
    expect(out.recovered).toBe(true);
    expect(out.result).toEqual({ ok: true, quarantined: 0 });
    expect(out.board).toBe(out.authoritative);
  });

  it('TC-09b: random bytes of the same length also quarantine cleanly', async () => {
    const retro = generateRetroBoard();
    const damaged = randomBytesLike(retro.updates[retro.updates.length - 1]);
    expect(() => Y.applyUpdate(new Y.Doc(), damaged)).toThrow();
    const out = await runInDurableObject(
      boardStub(newBoardId()),
      (_obj, state) => {
        const store = new BoardStore(state.storage);
        store.migrate();
        for (const update of retro.updates) store.append(update);
        const lastSeq = state.storage.sql
          .exec('SELECT MAX(seq) AS m FROM updates')
          .toArray()[0].m as number;
        state.storage.sql.exec(
          'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
          damaged,
          damaged.byteLength,
          lastSeq,
        );
        const doc = new Y.Doc();
        const result = new BoardStore(state.storage).load(doc);
        return { result, noteCount: snapshot(doc).length };
      },
    );
    expect(out.result).toEqual({ ok: true, quarantined: 1 });
    expect(out.noteCount).toBe(25);
  });
});
