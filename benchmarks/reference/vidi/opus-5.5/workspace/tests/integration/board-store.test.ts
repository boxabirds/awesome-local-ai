import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { BoardStore, META_SCHEMA_VERSION } from '../../src/worker/board-store';
import {
  RETRO_NOTES,
  boardState,
  largeBoard,
  randomLike,
  retroLog,
  truncated,
} from '../fixtures/boards';
import {
  blobRows,
  count,
  inRoom,
  meta,
  overwrite,
  reload,
  tableNames,
  throughSeq,
  writeLog,
} from './storage';
import { docJson, join } from './ws-client';

const DAMAGED_ROW = 7;
const EXTRA_CHANGES = 3;
const SMALL_CHUNK_BYTES = 64 * 1024;
const LARGE_BOARD_TIMEOUT_MS = 60_000;
const TABLES = ['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates'];

const damages: [string, (u: Uint8Array) => Uint8Array][] = [
  ['truncated', truncated],
  ['random bytes of the same length', (u) => randomLike(u)],
];

describe('persist.board_store against real Durable Object SQLite', () => {
  it('TC-03 Empty: migrate + load → tables exist, doc empty, schema version recorded', async () => {
    await inRoom(newBoardId(), (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const doc = new Y.Doc();
      expect(store.load(doc)).toEqual({ ok: true, quarantined: 0 });
      expect(tableNames(storage)).toEqual(expect.arrayContaining(TABLES));
      expect(snapshot(doc)).toHaveLength(0);
      expect(meta(storage, META_SCHEMA_VERSION)).toBe(String(STORAGE_SCHEMA_VERSION));
    });
  });

  it('TC-04 append one update → 1 row; bytes column equals its length', async () => {
    await inRoom(newBoardId(), (storage) => {
      const doc = new Y.Doc();
      let update: Uint8Array | undefined;
      doc.on('update', (u: Uint8Array) => {
        update = u;
      });
      createSticky(doc, { x: 1, y: 2 });
      const store = new BoardStore(storage);
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      store.append(update!);
      expect(count(storage, 'updates')).toBe(1);
      const row = storage.sql.exec('SELECT data, bytes FROM updates').one();
      expect(Number(row.bytes)).toBe(update!.byteLength);
      expect(new Uint8Array(row.data as ArrayBuffer)).toEqual(update);
    });
  });

  it(`TC-05 LogOnly ${RETRO_NOTES} notes → loads into a fresh doc identical to the original`, async () => {
    const log = retroLog();
    await inRoom(newBoardId(), (storage) => {
      writeLog(storage, log.updates);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(RETRO_NOTES);
      expect(boardState(doc)).toEqual(boardState(log.doc));
      expect(docJson(doc)).toEqual(docJson(log.doc));
    });
  });

  it(`TC-06 compaction at exactly COMPACTION_UPDATE_COUNT rows (not at one fewer)`, async () => {
    const log = retroLog();
    log.padTo(COMPACTION_UPDATE_COUNT);
    await inRoom(newBoardId(), (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      const doc = new Y.Doc();
      log.updates.forEach((u, i) => {
        Y.applyUpdate(doc, u);
        store.append(u);
        if (i === COMPACTION_UPDATE_COUNT - 2) {
          expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT - 1);
          expect(store.compactIfNeeded(doc)).toBe(false);
        }
      });
      expect(count(storage, 'updates')).toBe(COMPACTION_UPDATE_COUNT);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      const maxSeq = Number(storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m);

      expect(store.compactIfNeeded(doc)).toBe(true);

      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBeGreaterThanOrEqual(1);
      expect(throughSeq(storage)).toBe(maxSeq);
      expect(store.logSize()).toEqual({ count: 0, bytes: 0 });
      const reloaded = reload(storage);
      expect(reloaded.result).toEqual({ ok: true, quarantined: 0 });
      expect(docJson(reloaded.doc)).toEqual(docJson(log.doc));
    });
  });

  it('TC-07 SnapshotPlusLog: 3 changes after compaction reload too; only rows after through_seq are applied', async () => {
    const log = retroLog();
    await inRoom(newBoardId(), (storage) => {
      const store = writeLog(storage, log.updates);
      expect(store.compact(log.doc)).toBe(true);
      const through = throughSeq(storage);
      expect(through).toBe(log.updates.length);

      const before = log.updates.length;
      for (let i = 0; i < EXTRA_CHANGES; i += 1) {
        log.step((d) => {
          createSticky(d, { x: 2000 + i * 250, y: 0 }, 'blue');
        });
      }
      log.updates.slice(before).forEach((u) => store.append(u));
      expect(count(storage, 'updates')).toBe(EXTRA_CHANGES);

      // A valid row at or below through_seq (already in the snapshot) must be ignored.
      const stray = new Y.Doc();
      let strayUpdate: Uint8Array | undefined;
      stray.on('update', (u: Uint8Array) => {
        strayUpdate = u;
      });
      const strayId = createSticky(stray, { x: -5000, y: -5000 });
      storage.sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', through, strayUpdate!.slice().buffer, strayUpdate!.byteLength);

      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toHaveLength(RETRO_NOTES + EXTRA_CHANGES);
      expect(docJson(doc)).toEqual(docJson(log.doc));
      expect(snapshot(doc).map((n) => n.id)).not.toContain(strayId);
    });
  });

  it(
    `TC-08 a ${PERSIST_TESTED_NOTES}-note board compacts into ceil(size / SNAPSHOT_CHUNK_BYTES) chunks and reloads equal`,
    async () => {
      const board = largeBoard();
      const encoded = Y.encodeStateAsUpdate(board).byteLength;
      console.info(`TC-08 ${PERSIST_TESTED_NOTES}-note board encodes to ${encoded} bytes`);
      await inRoom(newBoardId(), (storage) => {
        const store = writeLog(storage, [Y.encodeStateAsUpdate(board)]);
        expect(store.compact(board)).toBe(true);
        const chunks = count(storage, 'snapshot_chunks');
        expect(chunks).toBe(Math.ceil(encoded / SNAPSHOT_CHUNK_BYTES));
        if (encoded > SNAPSHOT_CHUNK_BYTES) expect(chunks).toBeGreaterThan(1);
        const { doc, result } = reload(storage);
        expect(result).toEqual({ ok: true, quarantined: 0 });
        expect(snapshot(doc)).toHaveLength(PERSIST_TESTED_NOTES);
        expect(boardState(doc)).toEqual(boardState(board));
      });

      // The multi-chunk path regardless of the board's encoded size.
      await inRoom(newBoardId(), (storage) => {
        const store = new BoardStore(storage, { snapshotChunkBytes: SMALL_CHUNK_BYTES });
        store.migrate();
        expect(store.compact(board)).toBe(true);
        expect(count(storage, 'snapshot_chunks')).toBe(Math.ceil(encoded / SMALL_CHUNK_BYTES));
        expect(count(storage, 'snapshot_chunks')).toBeGreaterThan(1);
        const { doc } = reload(storage);
        expect(boardState(doc)).toEqual(boardState(board));
      });
    },
    LARGE_BOARD_TIMEOUT_MS,
  );

  for (const [name, damage] of damages) {
    it(`TC-09 log row ${DAMAGED_ROW} damaged (${name}) → quarantined; every other note loads`, async () => {
      const log = retroLog();
      const expected = new Y.Doc();
      log.updates.forEach((u, i) => {
        if (i !== DAMAGED_ROW - 1) Y.applyUpdate(expected, u);
      });
      await inRoom(newBoardId(), (storage) => {
        writeLog(storage, log.updates);
        const damaged = damage(log.updates[DAMAGED_ROW - 1]!);
        overwrite(storage, 'updates', DAMAGED_ROW, damaged);
        const rowsBefore = count(storage, 'updates');

        const { doc, result } = reload(storage);

        expect(result).toEqual({ ok: true, quarantined: 1 });
        expect(count(storage, 'updates')).toBe(rowsBefore - 1);
        const q = storage.sql.exec('SELECT seq, data, error, quarantined_at FROM quarantined_updates').toArray();
        expect(q).toHaveLength(1);
        expect(Number(q[0]!.seq)).toBe(DAMAGED_ROW);
        expect(new Uint8Array(q[0]!.data as ArrayBuffer)).toEqual(damaged);
        expect(String(q[0]!.error).length).toBeGreaterThan(0);
        expect(Number(q[0]!.quarantined_at)).toBeGreaterThan(0);
        expect(snapshot(doc)).toHaveLength(RETRO_NOTES - 1);
        expect(boardState(doc)).toEqual(boardState(expected));
      });
    });

    it(`TC-10 snapshot chunk 0 damaged (${name}) → snapshot-unreadable; nothing deleted or quarantined`, async () => {
      const log = retroLog();
      await inRoom(newBoardId(), (storage) => {
        const store = writeLog(storage, log.updates);
        expect(store.compact(log.doc)).toBe(true);
        const chunk0 = blobRows(storage, 'snapshot_chunks')[0]![1];
        overwrite(storage, 'snapshot_chunks', 0, damage(Uint8Array.from(chunk0)));
        const before = { chunks: blobRows(storage, 'snapshot_chunks'), log: blobRows(storage, 'updates') };

        const { result } = reload(storage);

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe('snapshot-unreadable');
        expect(blobRows(storage, 'snapshot_chunks')).toEqual(before.chunks);
        expect(blobRows(storage, 'updates')).toEqual(before.log);
        expect(count(storage, 'quarantined_updates')).toBe(0);
      });
    });
  }

  it('TC-11 a statement failing after DELETE snapshot_chunks rolls the compaction back', async () => {
    const log = retroLog();
    await inRoom(newBoardId(), (storage) => {
      const store = writeLog(storage, log.updates);
      expect(store.compact(log.doc)).toBe(true);
      log.padTo(log.updates.length + COMPACTION_UPDATE_COUNT);
      log.updates.slice(-COMPACTION_UPDATE_COUNT).forEach((u) => store.append(u));
      const before = {
        chunks: blobRows(storage, 'snapshot_chunks'),
        log: blobRows(storage, 'updates'),
        through: throughSeq(storage),
      };
      expect(before.log).toHaveLength(COMPACTION_UPDATE_COUNT);

      const statements: string[] = [];
      const realSql = store.sql.bind(store);
      store.sql = (query, ...bindings) => {
        statements.push(query);
        if (query.startsWith('INSERT INTO snapshot_chunks')) throw new Error('injected write failure');
        return realSql(query, ...bindings);
      };
      expect(store.compactIfNeeded(log.doc)).toBe(false);
      expect(statements).toContain('DELETE FROM snapshot_chunks');

      expect(blobRows(storage, 'snapshot_chunks')).toEqual(before.chunks);
      expect(blobRows(storage, 'updates')).toEqual(before.log);
      expect(throughSeq(storage)).toBe(before.through);
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(docJson(doc)).toEqual(docJson(log.doc));
    });
  });

  it('TC-25 a never-edited board writes no log or snapshot rows, even when someone opens it', async () => {
    const boardId = newBoardId();
    await inRoom(boardId, (storage) => {
      const store = new BoardStore(storage);
      store.migrate();
      store.migrate();
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
    });
    const visitor = await join(boardId);
    await visitor.barrier();
    visitor.close();
    await inRoom(boardId, (storage) => {
      expect(count(storage, 'updates')).toBe(0);
      expect(count(storage, 'snapshot_chunks')).toBe(0);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });
});
