/**
 * Board storage integration tests (TC-03 to TC-11, TC-25).
 *
 * These run inside workerd against real SQLite-backed Durable Object storage, because every
 * claim under test is about that storage: that a written row is a row that survives a restart,
 * that a compaction which fails halfway leaves a board exactly as it was, and that a board
 * with one unreadable change opens with everything except that change. Nothing is mocked:
 * `BoardStore` is handed `state.storage` and the assertions read the tables back with SQL.
 */
import { describe, expect, test } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { isStickySnapshot, snapshot } from '../../src/shared/board-model';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  boardUpdate,
  chunkCount,
  damagedUpdate,
  docFromUpdates,
  longTextBoard,
  newDoc,
  phraseBoard,
  retroBoard,
  sameBoardState,
  simulateAuthors,
  unreadableSnapshot,
  type AuthoredSession,
  type LogEntry,
} from '../fixtures/boards';

/** Run `fn` inside the board's room object, with access to its raw storage state. */
async function inRoom<T>(
  boardId: string,
  fn: (room: BoardRoom, state: DurableObjectState) => T,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room, state) => fn(room, state));
}

/** Run `fn` with a `BoardStore` over one board's storage, returning what it measured. */
function withStore<T>(
  boardId: string,
  fn: (store: BoardStore, state: DurableObjectState) => T,
): Promise<T> {
  return inRoom(boardId, (_room, state) => fn(new BoardStore(state.storage), state));
}

/** `store.migrate()` plus the log filled with a session's changes, in order. */
function author(store: BoardStore, session: AuthoredSession): void {
  store.migrate();
  for (const update of session.updates) store.append(update);
}

function countRows(state: DurableObjectState, table: string): number {
  return state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

function readMeta(state: DurableObjectState, key: string): string | null {
  const rows = state.storage.sql
    .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
    .toArray();
  return rows.length > 0 ? (rows[0]?.value ?? null) : null;
}

/** The byte length of every snapshot row, oldest first. */
function snapshotSizes(state: DurableObjectState): number[] {
  return state.storage.sql
    .exec<{ n: number }>('SELECT length(data) AS n FROM snapshot_chunks ORDER BY idx')
    .toArray()
    .map((row) => row.n);
}

/** The snapshot's bytes, as stored. */
function snapshotBytes(state: DurableObjectState): number[] {
  return state.storage.sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
    .toArray()
    .flatMap((row) => Array.from(new Uint8Array(row.data)));
}

/** The text a note ended with, according to the authors' converged documents. */
function expectedText(session: AuthoredSession, id: string): string {
  const doc = session.docs[0];
  if (!doc) throw new Error('the session has no documents');
  const note = snapshot(doc).filter(isStickySnapshot).find((each) => each.id === id);
  if (!note) throw new Error('the session does not contain that note');
  return note.text;
}

/** A document that holds the board of one or more sessions: what compaction folds from. */
function boardOf(...sessions: readonly AuthoredSession[]): Y.Doc {
  return docFromUpdates(sessions.flatMap((session) => [...session.updates]));
}

describe('a board that has never been opened (TC-03, TC-25)', () => {
  test('TC-03: migrate creates the tables, load succeeds on nothing', async () => {
    const outcome = await withStore(newBoardId(), (store, state) => {
      store.migrate();
      const doc = newDoc();
      const load = store.load(doc);
      return {
        load,
        tables: state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
          .toArray()
          .map((row) => row.name),
        schemaVersion: readMeta(state, 'storage_schema_version'),
        objects: doc.getMap('objects').size,
        metaSchema: doc.getMap('meta').get('schemaVersion'),
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    for (const table of ['updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta']) {
      expect(outcome.tables).toContain(table);
    }
    expect(outcome.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    // the board is empty, and that is reported honestly: an empty document, not a failure
    expect(outcome.objects).toBe(0);
    expect(outcome.metaSchema).toBeUndefined();
  });

  test('TC-25: migrate on a never-edited board writes no content rows', async () => {
    const boardId = newBoardId();
    const first = await withStore(boardId, (store, state) => {
      store.migrate();
      return {
        updates: countRows(state, 'updates'),
        chunks: countRows(state, 'snapshot_chunks'),
        quarantined: countRows(state, 'quarantined_updates'),
      };
    });
    expect(first).toEqual({ updates: 0, chunks: 0, quarantined: 0 });

    // and doing it again - which is what every wake-up does - still writes nothing
    const again = await withStore(boardId, (store, state) => {
      store.migrate();
      store.migrate();
      const doc = newDoc();
      const load = store.load(doc);
      return {
        load,
        updates: countRows(state, 'updates'),
        chunks: countRows(state, 'snapshot_chunks'),
        schemaVersion: readMeta(state, 'storage_schema_version'),
      };
    });
    expect(again.load).toEqual({ ok: true, quarantined: 0 });
    expect(again.updates).toBe(0);
    expect(again.chunks).toBe(0);
    expect(again.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
  });
});

describe('the log holds every change (TC-04, TC-05)', () => {
  test('TC-04: one update is one row, and the bytes column is its length', async () => {
    const session = simulateAuthors(1, 1);
    const update = session.updates[1]; // the note creation, after the schema write
    if (!update) throw new Error('the fixture writes a schema version then a note');

    const outcome = await withStore(newBoardId(), (store, state) => {
      store.migrate();
      store.append(update);
      const row = state.storage.sql
        .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
          'SELECT seq, data, bytes FROM updates',
        )
        .one();
      return {
        rows: countRows(state, 'updates'),
        seq: row.seq,
        bytes: row.bytes,
        stored: Array.from(new Uint8Array(row.data)),
      };
    });

    expect(outcome.rows).toBe(1);
    expect(outcome.bytes).toBe(update.length);
    expect(outcome.stored).toEqual(Array.from(update));
  });

  test('TC-04: rows come back in the order they were written', async () => {
    const session = simulateAuthors(2, 6);
    const outcome = await withStore(newBoardId(), (store, state) => {
      author(store, session);
      return state.storage.sql
        .exec<{ seq: number; data: ArrayBuffer }>('SELECT seq, data FROM updates ORDER BY seq')
        .toArray();
    });

    expect(outcome.map((row) => row.seq)).toEqual(session.updates.map((_u, index) => index + 1));
    expect(outcome.map((row) => Array.from(new Uint8Array(row.data)))).toEqual(
      session.updates.map((update) => Array.from(update)),
    );
  });

  test('TC-05: a 25-note board read back from the log is the board that was written', async () => {
    const session = retroBoard();
    const boardId = newBoardId();

    await withStore(boardId, (store) => {
      author(store, session);
      return null;
    });

    const outcome = await withStore(boardId, (store) => {
      const doc = newDoc();
      const load = store.load(doc);
      const notes = snapshot(doc);
      return {
        load,
        notes: notes.length,
        texts: notes.filter(isStickySnapshot).map((note) => note.text).sort(),
        expected: snapshot(session.docs[0] as Y.Doc)
          .filter(isStickySnapshot)
          .map((note) => note.text)
          .sort(),
        same: sameBoardState(doc, session.docs[0] as Y.Doc),
        identicalBytes:
          JSON.stringify(Array.from(boardUpdate(doc))) ===
          JSON.stringify(Array.from(boardUpdate(session.docs[0] as Y.Doc))),
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.notes).toBe(25);
    expect(outcome.same).toBe(true);
    expect(outcome.texts).toEqual(outcome.expected);
    // byte-identical, not merely equivalent: the reload replays the very same changes
    expect(outcome.identicalBytes).toBe(true);
  });
});

describe('compaction (TC-06, TC-07, TC-08)', () => {
  test('TC-06: at the row threshold the log folds into a snapshot', async () => {
    const session = simulateAuthors(1, 250); // creation and typing: over COMPACTION_UPDATE_COUNT rows
    const outcome = await withStore(newBoardId(), (store, state) => {
      author(store, session);
      const before = {
        logRows: countRows(state, 'updates'),
        chunks: snapshotSizes(state),
        state: Array.from(boardUpdate(boardOf(session))),
      };
      const maxSeq = state.storage.sql
        .exec<{ seq: number }>('SELECT COALESCE(MAX(seq), 0) AS seq FROM updates')
        .one().seq;

      const compacted = store.compactIfNeeded(boardOf(session));
      const doc = newDoc();
      const load = store.load(doc);
      return {
        before,
        maxSeq,
        compacted,
        logRows: countRows(state, 'updates'),
        chunks: snapshotSizes(state),
        throughSeq: readMeta(state, 'snapshot_through_seq'),
        load,
        stateAfter: Array.from(boardUpdate(doc)),
      };
    });

    expect(outcome.before.logRows).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    expect(outcome.before.chunks).toEqual([]);
    expect(outcome.compacted).toBe(true);
    expect(outcome.logRows).toBe(0);
    expect(outcome.chunks.length).toBeGreaterThanOrEqual(1);
    expect(outcome.throughSeq).toBe(String(outcome.maxSeq));
    // the board before the fold and the board read back after it are the same bytes
    expect(outcome.stateAfter).toEqual(outcome.before.state);
    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
  });

  test('TC-06: a store that only read the log still knows it is over the threshold', async () => {
    const session = simulateAuthors(1, 250);
    const boardId = newBoardId();
    await withStore(boardId, (store) => {
      author(store, session);
      return null;
    });

    const outcome = await withStore(boardId, (store, state) => {
      const doc = newDoc();
      const load = store.load(doc);
      // the counters are in memory, so a fresh store only knows the log is long because load
      // measured it; without that, a room that had been restarted would never compact
      const compacted = store.compactIfNeeded(doc);
      return { load, compacted, logRows: countRows(state, 'updates') };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.compacted).toBe(true);
    expect(outcome.logRows).toBe(0);
  });

  test('TC-07: a snapshot plus three log rows reads back whole, and older rows are left alone', async () => {
    const boardId = newBoardId();
    const folded = simulateAuthors(1, 250);
    await withStore(boardId, (store) => {
      author(store, folded);
      expect(store.compactIfNeeded(boardOf(folded))).toBe(true);
      return null;
    });

    const later = simulateAuthors(2, 2); // four notes, typed by two other authors
    // an old row put back by hand below the snapshot's seq: if the load read rows it should
    // have skipped, this unreadable one would either damage the board or be quarantined
    const junk = damagedUpdate('random-bytes');

    const outcome = await withStore(boardId, (store, state) => {
      for (const update of later.updates) store.append(update);
      const throughSeq = Number(readMeta(state, 'snapshot_through_seq'));
      const ghost = throughSeq - 5;
      state.storage.sql.exec(
        'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
        ghost,
        junk,
        junk.length,
      );
      const seqs = state.storage.sql
        .exec<{ seq: number }>('SELECT seq FROM updates ORDER BY seq')
        .toArray()
        .map((row) => row.seq);

      const doc = newDoc();
      const load = store.load(doc);
      return {
        load,
        throughSeq,
        ghost,
        seqs,
        same: sameBoardState(doc, boardOf(folded, later)),
        quarantined: countRows(state, 'quarantined_updates'),
        logRows: countRows(state, 'updates'),
        notes: snapshot(doc).length,
      };
    });

    expect(outcome.throughSeq).toBeGreaterThan(5);
    expect(outcome.seqs.filter((seq) => seq > outcome.throughSeq)).toHaveLength(
      later.updates.length,
    );
    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    // the row below the snapshot was never read: nothing was quarantined and it is still there
    expect(outcome.quarantined).toBe(0);
    expect(outcome.logRows).toBe(later.updates.length + 1);
    expect(outcome.notes).toBe(250 + later.notes);
    expect(outcome.same).toBe(true);
  });

  test('TC-08: the biggest board this product is tested with folds and reloads', async () => {
    const session = phraseBoard();
    expect(session.notes).toBe(PERSIST_TESTED_NOTES);
    const encodedSize = boardUpdate(boardOf(session)).length;
    const boardId = newBoardId();

    const outcome = await withStore(boardId, (store, state) => {
      store.migrate();
      // seeding inside one transaction keeps a log this size from being one round trip per row
      state.storage.transactionSync(() => {
        for (const update of session.updates) store.append(update);
      });
      const logRows = countRows(state, 'updates');
      const compacted = store.compactIfNeeded(boardOf(session));
      return {
        logRows,
        compacted,
        chunkRows: countRows(state, 'snapshot_chunks'),
        logRowsAfter: countRows(state, 'updates'),
        largestChunk: Math.max(...snapshotSizes(state)),
      };
    });

    expect(outcome.logRows).toBe(session.updates.length);
    expect(outcome.compacted).toBe(true);
    if (encodedSize > SNAPSHOT_CHUNK_BYTES) expect(outcome.chunkRows).toBeGreaterThan(1);
    // no row is anywhere near the per-row limit that makes chunking necessary
    expect(outcome.largestChunk).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(outcome.logRowsAfter).toBe(0);

    const reloaded = await withStore(boardId, (store) => {
      const doc = newDoc();
      const load: LoadResult = store.load(doc);
      return { load, same: sameBoardState(doc, session.docs[0] as Y.Doc), notes: snapshot(doc).length };
    });
    expect(reloaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.notes).toBe(PERSIST_TESTED_NOTES);
    expect(reloaded.same).toBe(true);
  });
});

/** The row number (rows are 1, 2, 3, ...) that a logged change was stored in. */
function rowOf(session: AuthoredSession, wanted: (entry: LogEntry) => boolean): number {
  const index = session.entries.findIndex(wanted);
  if (index < 0) throw new Error('the fixture did not make the change this test damages');
  return index + 1;
}

/** The board a log gives with one row left out: what quarantining a row should cost. */
function boardWithout(session: AuthoredSession, seq: number): Y.Doc {
  return docFromUpdates(session.updates.filter((_update, index) => index + 1 !== seq));
}

/** Overwrite one row of a board's log with bytes that cannot be read. */
function damageRow(state: DurableObjectState, seq: number, damaged: Uint8Array): void {
  state.storage.sql.exec(
    'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
    damaged,
    damaged.length,
    seq,
  );
}

/** What the quarantine table holds, for a board with exactly one quarantined row. */
function quarantineRow(state: DurableObjectState): {
  seq: number;
  error: string;
  data: number[];
  at: number;
} {
  const row = state.storage.sql
    .exec<{ seq: number; error: string; data: ArrayBuffer; at: number }>(
      'SELECT seq, error, data, quarantined_at AS at FROM quarantined_updates',
    )
    .one();
  return { seq: row.seq, error: row.error, data: Array.from(new Uint8Array(row.data)), at: row.at };
}

describe('a snapshot too big for one row (TC-04b)', () => {
  test('TC-04b: a snapshot larger than the chunk size is written as chunks and read back whole', async () => {
    const session = longTextBoard();
    const encoded = boardUpdate(boardOf(session));
    expect(encoded.length).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    const boardId = newBoardId();

    const outcome = await withStore(boardId, (store, state) => {
      store.migrate();
      state.storage.transactionSync(() => {
        for (const update of session.updates) store.append(update);
      });
      const compacted = store.compactIfNeeded(boardOf(session));
      return {
        compacted,
        chunks: snapshotSizes(state),
        bytes: snapshotBytes(state),
        logRows: countRows(state, 'updates'),
      };
    });

    expect(outcome.compacted).toBe(true);
    // more than one row, each within the limit that makes chunking necessary, and together they
    // are exactly the update the store encoded - so reassembly cannot be off by a byte
    expect(outcome.chunks.length).toBe(chunkCount(encoded.length));
    expect(Math.max(...outcome.chunks)).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(outcome.bytes).toEqual(Array.from(encoded));
    // the folded log is gone: nothing is left over from the way the snapshot was built
    expect(outcome.logRows).toBe(0);

    const reloaded = await withStore(boardId, (store) => {
      const doc = newDoc();
      const load: LoadResult = store.load(doc);
      return {
        load,
        notes: snapshot(doc).length,
        same: sameBoardState(doc, boardOf(session)),
        text: snapshot(doc).filter(isStickySnapshot).at(-1)?.text.length ?? 0,
      };
    });
    expect(reloaded.load).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.notes).toBe(session.notes);
    expect(reloaded.same).toBe(true);
    // the kilobyte of text on the last note came back, not a truncated head of it
    expect(reloaded.text).toBe(1024 + ` (${session.notes - 1})`.length);
  });
});

describe('damage (TC-09, TC-10)', () => {
  test('TC-09: one damaged row costs that change and nothing else', async () => {
    const session = simulateAuthors(1, 10);
    // the last change in the log, which is the text of the last note: nothing was written after
    // it, so this is the case where a damaged row costs exactly one change and nothing more
    const damagedSeq = rowOf(session, (entry) => entry.kind === 'type' && entry.noteIndex === 9);
    const damagedTextOf = session.ids[9];
    const damaged = damagedUpdate();
    if (!damagedTextOf) throw new Error('the fixture made no note to check');

    const outcome = await withStore(newBoardId(), (store, state) => {
      author(store, session);
      const rowsBefore = countRows(state, 'updates');
      damageRow(state, damagedSeq, damaged);

      const doc = newDoc();
      const load = store.load(doc);
      return {
        damagedSeq,
        rowsBefore,
        load,
        notes: snapshot(doc),
        logRows: countRows(state, 'updates'),
        quarantineRows: countRows(state, 'quarantined_updates'),
        quarantine: quarantineRow(state),
        damagedStillInLog: state.storage.sql
          .exec<{ seq: number }>('SELECT seq FROM updates WHERE seq = ?', damagedSeq)
          .toArray(),
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 1 });
    // the row was moved out of the log and into the quarantine table, with why and when
    expect(outcome.damagedStillInLog).toEqual([]);
    expect(outcome.logRows).toBe(outcome.rowsBefore - 1);
    expect(outcome.quarantineRows).toBe(1);
    expect(outcome.quarantine.seq).toBe(outcome.damagedSeq);
    expect(outcome.quarantine.error.length).toBeGreaterThan(0);
    expect(outcome.quarantine.at).toBeGreaterThan(0);
    // the bytes are kept, so the change is available to repair rather than gone for good
    expect(outcome.quarantine.data).toEqual(Array.from(damaged));

    // and the board opens with all ten notes, only the damaged change missing
    expect(outcome.notes).toHaveLength(10);
    const byId = new Map(
      outcome.notes.filter(isStickySnapshot).map((note) => [note.id, note.text]),
    );
    expect(byId.get(damagedTextOf)).toBe('');
    for (const [index, id] of session.ids.entries()) {
      if (id === damagedTextOf) continue;
      expect(byId.get(id), `note ${index} kept its text`).toBe(expectedText(session, id));
    }
  });

  test('TC-09: the log after a damaged row is read as if only that row were missing', async () => {
    const authors = 2;
    const session = simulateAuthors(authors, 10);
    // damage the change that typed note 3, mid-log, and look at what the rest of the log costs.
    // Yjs will not place an author's items that sit behind a hole in that author's own clock, so
    // the honest claim is: the other author loses nothing, and the loaded board is exactly the
    // log with the damaged row left out - not less.
    const damagedSeq = rowOf(session, (entry) => entry.kind === 'type' && entry.noteIndex === 3);
    const damaged = damagedUpdate();
    const damagedAuthor = 3 % authors;
    const otherAuthor = 1 - damagedAuthor;
    const idsOf = (author: number) =>
      session.ids.filter((_id, index) => index % authors === author);

    const outcome = await withStore(newBoardId(), (store, state) => {
      author(store, session);
      const rowsBefore = countRows(state, 'updates');
      damageRow(state, damagedSeq, damaged);

      const doc = newDoc();
      const load = store.load(doc);
      return {
        damagedSeq,
        rowsBefore,
        load,
        notes: snapshot(doc),
        // the loaded board as bytes, to compare with what the log means without that row
        state: Array.from(boardUpdate(doc)),
        logRows: countRows(state, 'updates'),
        quarantine: quarantineRow(state),
        // every row that survived the load, still byte for byte what was written
        surviving: state.storage.sql
          .exec<{ seq: number; data: ArrayBuffer }>('SELECT seq, data FROM updates ORDER BY seq')
          .toArray()
          .map((row) => [row.seq, Array.from(new Uint8Array(row.data))] as const),
      };
    });

    expect(outcome.load).toEqual({ ok: true, quarantined: 1 });
    expect(outcome.logRows).toBe(outcome.rowsBefore - 1);
    expect(outcome.quarantine.seq).toBe(outcome.damagedSeq);
    expect(outcome.surviving.map(([seq]) => seq)).toEqual(
      session.updates
        .map((_update, index) => index + 1)
        .filter((seq) => seq !== outcome.damagedSeq),
    );
    for (const [seq, bytes] of outcome.surviving) {
      const written = session.updates[seq - 1];
      if (!written) throw new Error(`row ${seq} was never written`);
      expect(bytes, `row ${seq} is unchanged`).toEqual(Array.from(written));
    }

    // the loaded board is exactly what the log says with the damaged row left out, and no less
    expect(outcome.state).toEqual(Array.from(boardUpdate(boardWithout(session, outcome.damagedSeq))));

    // the author whose change was not damaged lost nothing at all
    const byId = new Map(
      outcome.notes.filter(isStickySnapshot).map((note) => [note.id, note.text]),
    );
    for (const id of idsOf(otherAuthor)) {
      expect(byId.get(id), 'the undamaged author kept every note and its text').toBe(
        expectedText(session, id),
      );
    }
    // the damaged change itself is gone, and so is everything its own author did afterwards -
    // the cost of a hole in one author's clock, documented here because it surprises everyone
    expect(byId.get(session.ids[3] ?? ''), 'the note the damaged change belonged to').toBe('');
    expect(byId.get(idsOf(damagedAuthor)[0] ?? ''), 'its author is intact before the hole').toBe(
      expectedText(session, idsOf(damagedAuthor)[0] ?? ''),
    );
    for (const id of idsOf(damagedAuthor).slice(2)) {
      expect(byId.has(id), 'a note behind the hole is not in the board').toBe(false);
    }
    expect(byId.size).toBeLessThan(session.ids.length);
  });

  test('TC-10: an unreadable snapshot is a board that failed to load, not an empty one', async () => {
    const boardId = newBoardId();
    const session = simulateAuthors(1, 250);
    const unreadable = unreadableSnapshot();

    const outcome = await withStore(boardId, (store, state) => {
      author(store, session);
      expect(store.compactIfNeeded(boardOf(session))).toBe(true);
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', unreadable);
      // what the damaged board looks like on the way in, so the comparison below is about what
      // the failed load did, not about the damage this test itself made
      const damaged = { chunks: snapshotSizes(state), bytes: snapshotBytes(state) };

      const doc = newDoc();
      const load = store.load(doc);
      return {
        damaged,
        load,
        objects: snapshot(doc).length,
        after: { chunks: snapshotSizes(state), bytes: snapshotBytes(state) },
        logRows: countRows(state, 'updates'),
        quarantineRows: countRows(state, 'quarantined_updates'),
      };
    });

    expect(outcome.load.ok).toBe(false);
    if (outcome.load.ok === false) {
      expect(outcome.load.reason).toBe('snapshot-unreadable');
      expect(outcome.load.error.length).toBeGreaterThan(0);
    }
    // nothing was repaired on the way out: the bytes are exactly as they were found, so a
    // later story can still recover them, and nothing was quietly deleted
    expect(outcome.after).toEqual(outcome.damaged);
    expect(outcome.after.bytes.length).toBeGreaterThan(0);
    expect(outcome.logRows).toBe(0);
    expect(outcome.quarantineRows).toBe(0);
    // and the room is not handed a half-read board to serve as an empty one
    expect(outcome.objects).toBe(0);
  });
});

describe('a compaction that fails halfway (TC-11)', () => {
  test('TC-11: the old snapshot and the whole log survive a rolled-back compaction', async () => {
    const boardId = newBoardId();
    const first = simulateAuthors(1, 250);
    const second = simulateAuthors(1, 250);

    await withStore(boardId, (store) => {
      author(store, first);
      expect(store.compactIfNeeded(boardOf(first))).toBe(true);
      return null;
    });

    const outcome = await withStore(boardId, (store, state) => {
      for (const update of second.updates) store.append(update);
      const before = {
        chunks: snapshotSizes(state),
        bytes: snapshotBytes(state),
        logRows: countRows(state, 'updates'),
        through: readMeta(state, 'snapshot_through_seq'),
      };

      store.failNext = 'compaction-after-delete';
      const failed = store.compactIfNeeded(boardOf(first, second));
      const after = {
        chunks: snapshotSizes(state),
        bytes: snapshotBytes(state),
        logRows: countRows(state, 'updates'),
        through: readMeta(state, 'snapshot_through_seq'),
      };

      // the same store with the fault gone, which is what the board does next: compact again,
      // and this time the fold happens and nothing was lost on the way
      store.failNext = null;
      const doc = newDoc();
      const retry = store.compactIfNeeded(boardOf(first, second));
      const load = store.load(doc);
      return {
        failed,
        before,
        after,
        retry,
        load,
        logRows: countRows(state, 'updates'),
        same: sameBoardState(doc, boardOf(first, second)),
      };
    });

    expect(outcome.failed).toBe(false);
    expect(outcome.after).toEqual(outcome.before);
    expect(outcome.retry).toBe(true);
    expect(outcome.logRows).toBe(0);
    expect(outcome.load).toEqual({ ok: true, quarantined: 0 });
    expect(outcome.same).toBe(true);
  });

  test('TC-11: a compaction that cannot begin is a false, not an exception', async () => {
    const session = simulateAuthors(1, 250);
    const outcome = await withStore(newBoardId(), (store, state) => {
      author(store, session);
      store.failNext = 'compaction';
      const compacted = store.compactIfNeeded(boardOf(session));
      return { compacted, logRows: countRows(state, 'updates') };
    });

    expect(outcome.compacted).toBe(false);
    expect(outcome.logRows).toBe(session.updates.length);
  });
});
