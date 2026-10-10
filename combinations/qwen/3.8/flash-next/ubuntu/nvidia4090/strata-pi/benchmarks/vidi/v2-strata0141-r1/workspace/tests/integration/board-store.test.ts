import { describe, it, expect, afterEach } from 'vitest';
import { reset, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  BoardStore,
  shouldCompact,
  type BoardStorage,
  type SqlValue,
} from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { createSticky, snapshot } from '../../src/shared/board-model';
import {
  batchUpdates,
  boardKey,
  largeBoard,
  randomBytesLike,
  retroBoard,
  RETRO_NOTE_COUNT,
  type BoardFixture,
} from '../fixtures/boards';
import { bindings, newBoardIdFor } from './helpers/room';

/**
 * TC-03 to TC-11, TC-25 (anchor `persist.board_store`).
 *
 * `BoardStore` driven against the real SQLite storage of a real board Durable
 * Object, from inside that object with `runInDurableObject`. Every byte appended
 * is a real Yjs update produced by the board-model fixtures, so what is checked
 * is what a board actually stores. Each test uses its own board id, so no test
 * can see another test's rows.
 *
 * The dimension class of each run (D1 storage state, D2 storage failure, D6
 * scale) is named in the test title.
 */

afterEach(async () => {
  // `reset()` discards every board object this test created; each test uses its
  // own board address, so nothing carries over.
  await reset();
});

/** What a storage test can do inside a board object. */
interface BoardAccess {
  readonly boardId: string;
  readonly store: BoardStore;
  sql(query: string, values?: SqlValue[]): Record<string, SqlValue>[];
  storage(): DurableObjectStorage;
}

/** Run `run` inside `label`'s board object, against its own storage. */
async function inBoard<T>(label: string, run: (access: BoardAccess) => T): Promise<T> {
  const ns = bindings().BOARD_ROOM;
  const boardId = newBoardIdFor(label);
  const stub = ns.get(ns.idFromName(boardId));
  return runInDurableObject(stub, (instance) =>
    run({
      boardId,
      store: instance.testStore(),
      sql: (query, values = []) => instance.testSql(query, values),
      storage: () => instance.testStorage(),
    }),
  );
}

/** Rows in one of the board's tables. */
const rowCount = (access: BoardAccess, table: string): number =>
  Number(access.sql(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0);

/** Append every update as its own log row. */
const appendAll = (store: BoardStore, updates: readonly Uint8Array[]): void => {
  for (const update of updates) {
    store.append(update);
  }
};

/** A fresh document loaded from this storage, plus what the load did. */
const loadFresh = (store: BoardStore): { doc: Y.Doc; quarantined: number; applied: number } => {
  const doc = new Y.Doc();
  // `applied` comes from inside the load: `LOAD_ORIGIN` is a symbol, and the
  // worker's copy of it is not the same symbol as the one this test imported.
  const result = store.load(doc);
  if (!result.ok) {
    throw new Error(`load refused: ${result.reason} (${result.error})`);
  }
  return { doc, quarantined: result.quarantined, applied: result.applied };
};

const notesOf = (doc: Y.Doc): number => snapshot(doc).length;

/** SQLite binds a blob from an `ArrayBuffer`. */
const blobOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer as ArrayBuffer;

/**
 * `count` updates that each add one new note, so a test can log changes that
 * are definitely not already in the board. They are produced on a document that
 * first takes the fixture's state, so the notes belong to the same shared
 * `objects` map a real client's notes belong to.
 */
const newNoteUpdates = (fixture: BoardFixture, count: number): Uint8Array[] => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.mergeUpdates(fixture.updates as Uint8Array[]));
  const updates: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const collected: Uint8Array[] = [];
    const observer = (update: Uint8Array): void => {
      collected.push(update);
    };
    doc.on('update', observer);
    doc.transact(() => {
      createSticky(doc, { x: 5_000 + index * 120, y: 5_000 }, 'pink');
    });
    doc.off('update', observer);
    updates.push(...collected);
  }
  return updates;
};

/** A `Y.Doc` holding everything the fixture's updates say, plus extra notes. */
const docBeyond = (fixture: BoardFixture, extras: number): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.mergeUpdates(fixture.updates as Uint8Array[]));
  for (let index = 0; index < extras; index += 1) {
    doc.transact(() => {
      createSticky(doc, { x: 4_000 + index * 100, y: 4_000 }, 'pink');
    });
  }
  return doc;
};

/**
 * Wrap the object's real storage so that, while armed, the meta write at the end
 * of a compaction throws. The throw happens inside `transactionSync`, which is
 * exactly the moment a compaction is half applied.
 */
class ExplodingStorage implements BoardStorage {
  private readonly inner: DurableObjectStorage;
  armed = false;
  /** How many statements the compaction got through before it failed. */
  statements = 0;

  constructor(inner: DurableObjectStorage) {
    this.inner = inner;
  }

  readonly sql = {
    exec: (query: string, ...args: SqlValue[]) => {
      this.statements += 1;
      if (this.armed && /^INSERT OR REPLACE INTO storage_meta/u.test(query)) {
        throw new Error('injected storage failure during compaction');
      }
      return this.inner.sql.exec(query, ...args);
    },
  };

  transactionSync<T>(closure: () => T): T {
    return this.inner.transactionSync(closure);
  }
}

describe('BoardStore', () => {
  it('TC-03 D1 storage state: migrate creates the tables and records the schema version', async () => {
    const result = await inBoard('migrate', (access) => {
      access.store.migrate();
      const loaded = loadFresh(access.store);
      return {
        stats: access.store.stats(),
        rows: {
          meta: rowCount(access, 'storage_meta'),
          updates: rowCount(access, 'updates'),
          snapshot: rowCount(access, 'snapshot_chunks'),
          quarantined: rowCount(access, 'quarantined_updates'),
        },
        notes: notesOf(loaded.doc),
      };
    });

    expect(result.rows.meta).toBeGreaterThanOrEqual(1);
    expect(result.stats.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.rows.updates).toBe(0);
    expect(result.rows.snapshot).toBe(0);
    expect(result.rows.quarantined).toBe(0);
    expect(result.notes).toBe(0);
  });

  it('TC-25 D1 storage state: migrating a board that was never edited writes no rows', async () => {
    const result = await inBoard('fresh-board', (access) => {
      access.store.migrate();
      const first = access.store.stats();
      access.store.migrate();
      const tables = access.sql(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
      );
      return { first, second: access.store.stats(), tables: tables.map((row) => String(row.name)) };
    });

    expect(result.first.updateRows).toBe(0);
    expect(result.first.snapshotChunks).toBe(0);
    expect(result.second.updateRows).toBe(0);
    expect(result.second.snapshotChunks).toBe(0);
    expect(result.second.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.tables).toEqual([
      'quarantined_updates',
      'snapshot_chunks',
      'storage_meta',
      'updates',
    ]);
  });

  it('TC-04 D1 storage state: append writes one log row holding the update and its byte count', async () => {
    const fixture = retroBoard();
    const first = fixture.updates[0]!;

    const result = await inBoard('append-one', (access) => {
      access.store.migrate();
      access.store.append(first);
      return {
        stats: access.store.stats(),
        rows: access.sql('SELECT seq, bytes, LENGTH(data) AS stored FROM updates'),
      };
    });

    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.bytes).toBe(first.byteLength);
    expect(result.rows[0]?.stored).toBe(first.byteLength);
    expect(result.stats.updateBytes).toBe(first.byteLength);
    expect(result.stats.updateRows).toBe(1);
  });

  it('TC-05 D1 storage state: a board appended update by update loads back identically', async () => {
    const fixture = retroBoard();

    const result = await inBoard('append-all', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);
      const loaded = loadFresh(access.store);
      return {
        expected: boardKey(fixture.notes),
        actual: boardKey(snapshot(loaded.doc)),
        rows: rowCount(access, 'updates'),
        applied: loaded.applied,
        quarantined: loaded.quarantined,
        notes: notesOf(loaded.doc),
      };
    });

    expect(result.rows).toBe(fixture.updates.length);
    expect(result.applied).toBe(fixture.updates.length);
    expect(result.quarantined).toBe(0);
    expect(result.actual).toBe(result.expected);
    expect(result.notes).toBe(RETRO_NOTE_COUNT);
  });

  it('TC-06 D6 scale: a log at COMPACTION_UPDATE_COUNT rows folds into a snapshot', async () => {
    const fixture = retroBoard();
    expect(fixture.updates.length).toBeGreaterThan(COMPACTION_UPDATE_COUNT);

    const result = await inBoard('compact-count', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates.slice(0, COMPACTION_UPDATE_COUNT));
      const before = access.store.stats();
      const maxSeq = Number(access.sql('SELECT MAX(seq) AS m FROM updates')[0]?.m ?? 0);
      const compacted = access.store.compactIfNeeded(fixture.doc);
      const after = access.store.stats();
      const loaded = loadFresh(access.store);
      return {
        before,
        after,
        maxSeq,
        compacted,
        through: access.store.snapshotThroughSeq(),
        expected: boardKey(fixture.notes),
        actual: boardKey(snapshot(loaded.doc)),
        chunks: access.sql('SELECT idx, LENGTH(data) AS len FROM snapshot_chunks ORDER BY idx ASC'),
      };
    });

    expect(result.compacted).toBe(true);
    expect(result.before.updateRows).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.after.updateRows).toBe(0);
    expect(result.after.snapshotChunks).toBeGreaterThanOrEqual(1);
    expect(result.through).toBe(result.maxSeq);
    expect(result.through).toBe(COMPACTION_UPDATE_COUNT);
    expect(result.actual).toBe(result.expected);
    expect(result.after.quarantinedRows).toBe(0);
    expect(result.chunks.length).toBe(result.after.snapshotChunks);
  });

  it('TC-07 D1 storage state: after a fold a reload reads only the rows above the snapshot', async () => {
    const fixture = retroBoard();
    const extra = newNoteUpdates(fixture, 3);

    const result = await inBoard('compact-then-log', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);
      access.store.compactIfNeeded(fixture.doc);
      appendAll(access.store, extra);
      const loaded = loadFresh(access.store);
      return {
        rows: rowCount(access, 'updates'),
        through: access.store.snapshotThroughSeq(),
        applied: loaded.applied,
        notes: notesOf(loaded.doc),
        snapshotChunks: access.store.stats().snapshotChunks,
        stored: boardKey(fixture.notes).split('\n'),
        loaded: boardKey(snapshot(loaded.doc)).split('\n'),
      };
    });

    // The folded rows are gone from the log; only the three new ones are there.
    expect(result.rows).toBe(3);
    expect(result.through).toBe(fixture.updates.length);
    // Just the three log rows on top of the snapshot.
    expect(result.applied).toBe(extra.length);
    expect(result.snapshotChunks).toBeGreaterThanOrEqual(1);
    // The board as stored, plus the three notes logged after the fold.
    expect(result.notes).toBe(RETRO_NOTE_COUNT + extra.length);
    expect(result.loaded.length).toBeGreaterThan(result.stored.length);
    expect(result.stored.filter((line) => !result.loaded.includes(line))).toEqual([]);
  });

  it('TC-08 D6 scale: a PERSIST_TESTED_NOTES board compacts into several chunk rows', async () => {
    const result = await inBoard('compact-large', (access) => {
      const fixture = largeBoard();
      // Batched into clearly more rows than the count threshold, the way one
      // message carrying several transactions arrives.
      const rows = batchUpdates(fixture.updates, COMPACTION_UPDATE_COUNT + 200);
      access.store.migrate();
      appendAll(access.store, rows);
      const before = access.store.stats();
      const compacted = access.store.compactIfNeeded(fixture.doc);
      const after = access.store.stats();
      const loaded = loadFresh(access.store);
      return {
        notes: fixture.notes.length,
        rowBytes: before.updateBytes,
        encoded: Y.encodeStateAsUpdate(fixture.doc).byteLength,
        compacted,
        after,
        expected: boardKey(fixture.notes),
        actual: boardKey(snapshot(loaded.doc)),
        loadedNotes: notesOf(loaded.doc),
      };
    });

    expect(result.notes).toBe(2_000);
    expect(result.encoded).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(result.rowBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(result.compacted).toBe(true);
    expect(result.after.updateRows).toBe(0);
    // More than one row, each at most SNAPSHOT_CHUNK_BYTES long.
    expect(result.after.snapshotChunks).toBeGreaterThan(1);
    expect(result.after.snapshotBytes).toBe(result.encoded);
    expect(result.loadedNotes).toBe(2_000);
    expect(result.actual).toBe(result.expected);
  });

  it('TC-09 D2 storage failure: a damaged log row is quarantined and the rest of the board loads', async () => {
    const fixture = retroBoard();

    const result = await inBoard('damage-log-row', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);

      // The last row is the final word of the last note: bytes Yjs cannot read.
      const target = access.sql('SELECT seq, data FROM updates ORDER BY seq DESC LIMIT 1')[0];
      const seq = Number(target?.seq);
      const original = new Uint8Array(target?.data as ArrayBuffer);
      access.sql('UPDATE updates SET data = ? WHERE seq = ?', [blobOf(randomBytesLike(original, 7)), seq]);

      const loaded = loadFresh(access.store);
      const quarantined = access.sql('SELECT seq, error, LENGTH(data) AS len FROM quarantined_updates');
      return {
        seq,
        quarantined: loaded.quarantined,
        applied: loaded.applied,
        rows: quarantined,
        remaining: rowCount(access, 'updates'),
        notes: snapshot(loaded.doc),
        expectedTexts: fixture.notes.map((note) => note.text),
      };
    });

    expect(result.quarantined).toBe(1);
    expect(result.applied).toBe(fixture.updates.length - 1);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.seq).toBe(result.seq);
    expect(String(result.rows[0]?.error).length).toBeGreaterThan(0);
    expect(result.remaining).toBe(fixture.updates.length - 1);

    // Everything else is there: the board is partial, not empty.
    expect(result.notes.length).toBe(RETRO_NOTE_COUNT);
    const damaged = result.notes.filter((note, index) => note.text !== result.expectedTexts[index]);
    expect(damaged.length).toBe(1);
  });

  it('TC-09b D2 storage failure: damage at a writer boundary leaves other writers whole', async () => {
    const fixture = retroBoard();
    const otherWriter = newNoteUpdates(fixture, 5);

    const result = await inBoard('damage-writer-boundary', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);
      appendAll(access.store, otherWriter);

      // The last row of the first writer: everything before it is readable,
      // everything after it was written by a different client.
      const lastOfFirst = fixture.updates.length;
      const target = access.sql('SELECT seq, data FROM updates ORDER BY seq ASC LIMIT 1 OFFSET ?', [lastOfFirst - 1])[0];
      const seq = Number(target?.seq);
      const original = new Uint8Array(target?.data as ArrayBuffer);
      access.sql('UPDATE updates SET data = ? WHERE seq = ?', [blobOf(randomBytesLike(original, 13)), seq]);

      const loaded = loadFresh(access.store);
      const notes = snapshot(loaded.doc);
      return {
        seq,
        quarantined: loaded.quarantined,
        remaining: rowCount(access, 'updates'),
        notes: notes.length,
        // `newNoteUpdates` places its notes far to the right of the retro grid.
        extraNotes: notes.filter((note) => note.x > 4_000).length,
        // Which of the written notes no longer reads the way it was written?
        changed: notes.filter(
          (note) => note.text.length > 0 && !fixture.notes.some((expected) => expected.text === note.text),
        ),
      };
    });

    // The board loads, and the damage is quarantined rather than fatal.
    expect(result.quarantined).toBe(1);
    expect(result.remaining).toBe(fixture.updates.length - 1 + otherWriter.length);
    // The notes written by the other writer are all there.
    expect(result.extraNotes).toBe(5);
    expect(result.notes).toBe(RETRO_NOTE_COUNT + 5);
    // Only the damaged row's content is gone: one note lost its last word.
    expect(result.changed.length).toBe(1);
    // What is missing from it is the one word that row carried.
    expect((result.changed[0]?.text.split(/\s+/u).length ?? 0)).toBeGreaterThan(5);
  });

  it('TC-09c D2 storage failure: damage inside a writer run stays survivable damage', async () => {
    // Extra coverage, and it documents a limit worth knowing before anyone plans
    // a repair tool: a Yjs update is contiguous with the same writer's earlier
    // updates, so a row that is gone also costs that writer's later rows.
    // Quarantining is what keeps the rest of the board alive, and the log stays
    // usable afterwards. How many notes survive is Yjs behaviour rather than
    // storage behaviour, so it is not asserted here.
    const fixture = retroBoard();

    const result = await inBoard('damage-middle-row', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);

      const target = access.sql('SELECT seq, data FROM updates ORDER BY seq ASC LIMIT 1 OFFSET 6')[0];
      const seq = Number(target?.seq);
      const original = new Uint8Array(target?.data as ArrayBuffer);
      access.sql('UPDATE updates SET data = ? WHERE seq = ?', [blobOf(randomBytesLike(original, 13)), seq]);

      const first = loadFresh(access.store);
      const second = loadFresh(access.store);
      return {
        seq,
        firstQuarantined: first.quarantined,
        quarantinedRows: rowCount(access, 'quarantined_updates'),
        remaining: rowCount(access, 'updates'),
        secondApplied: second.applied,
        secondQuarantined: second.quarantined,
      };
    });

    expect(result.firstQuarantined).toBe(1);
    expect(result.quarantinedRows).toBe(1);
    expect(result.remaining).toBe(fixture.updates.length - 1);
    // The log is still a log: it loads again, and reads the rows that are left.
    expect(result.secondApplied).toBe(fixture.updates.length - 1);
    expect(result.secondQuarantined).toBe(0);
  });

  it('TC-10 D2 storage failure: an unreadable snapshot refuses the board and deletes nothing', async () => {
    const fixture = retroBoard();

    const result = await inBoard('damage-snapshot', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates);
      access.store.compactIfNeeded(fixture.doc);
      const before = access.store.stats();

      const chunk = access.sql('SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC LIMIT 1')[0];
      const idx = Number(chunk?.idx);
      const original = new Uint8Array(chunk?.data as ArrayBuffer);
      access.sql('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', [blobOf(randomBytesLike(original, 11)), idx]);

      const doc = new Y.Doc();
      const load = access.store.load(doc);
      return {
        load,
        before,
        after: access.store.stats(),
        notes: notesOf(doc),
        quarantinedRows: rowCount(access, 'quarantined_updates'),
        chunkRows: access.sql('SELECT idx, LENGTH(data) AS len FROM snapshot_chunks ORDER BY idx ASC'),
      };
    });

    expect(result.load.ok).toBe(false);
    if (!result.load.ok) {
      expect(result.load.reason).toBe('snapshot-unreadable');
      expect(result.load.error.length).toBeGreaterThan(0);
    }
    // Nothing was quarantined and nothing was dropped: the damage stays put.
    expect(result.quarantinedRows).toBe(0);
    expect(result.after).toEqual(result.before);
    expect(result.chunkRows.length).toBe(result.before.snapshotChunks);
    // And the room is not allowed to present this as an empty board.
    expect(result.notes).toBe(0);
  });

  it('TC-11 D2 storage failure: a compaction that fails halfway rolls back', async () => {
    const fixture = retroBoard();

    const result = await inBoard('compact-rollback', (access) => {
      const exploding = new ExplodingStorage(access.storage());
      const store = new BoardStore(exploding);
      store.migrate();

      appendAll(store, fixture.updates);
      // First fold succeeds, so there is an earlier snapshot to fall back to.
      const folded = store.compactIfNeeded(fixture.doc);
      const good = store.stats();

      // Log again, and try a fold that would write a bigger snapshot than the
      // board actually has stored.
      appendAll(store, fixture.updates);
      exploding.armed = true;
      const compacted = store.compactIfNeeded(docBeyond(fixture, 3));
      exploding.armed = false;
      const after = store.stats();

      // Still loadable: the snapshot plus the intact log.
      const loaded = loadFresh(store);
      const retried = store.compactIfNeeded(fixture.doc);
      return {
        folded,
        good,
        compacted,
        after,
        loadedNotes: notesOf(loaded.doc),
        retried,
        finalStats: store.stats(),
        expected: boardKey(fixture.notes),
        actual: boardKey(snapshot(loaded.doc)),
        statements: exploding.statements,
      };
    });

    expect(result.folded).toBe(true);
    expect(result.good.snapshotChunks).toBeGreaterThanOrEqual(1);
    expect(result.good.updateRows).toBe(0);
    expect(result.compacted).toBe(false);
    // Rolled back: same snapshot bytes as before, log untouched.
    expect(result.after.snapshotChunks).toBe(result.good.snapshotChunks);
    expect(result.after.snapshotBytes).toBe(result.good.snapshotBytes);
    expect(result.after.updateRows).toBe(fixture.updates.length);
    expect(result.loadedNotes).toBe(RETRO_NOTE_COUNT);
    expect(result.actual).toBe(result.expected);
    // And the board can be folded once the failure is gone.
    expect(result.retried).toBe(true);
    expect(result.finalStats.updateRows).toBe(0);
    expect(result.statements).toBeGreaterThan(0);
  });

  it('TC-02 boundary in storage: a log just under either threshold is left alone', async () => {
    const fixture = retroBoard();
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);

    const result = await inBoard('below-threshold', (access) => {
      access.store.migrate();
      appendAll(access.store, fixture.updates.slice(0, COMPACTION_UPDATE_COUNT - 1));
      const compacted = access.store.compactIfNeeded(fixture.doc);
      return { compacted, stats: access.store.stats() };
    });

    expect(result.compacted).toBe(false);
    expect(result.stats.updateRows).toBe(COMPACTION_UPDATE_COUNT - 1);
    expect(result.stats.snapshotChunks).toBe(0);
  });
});
