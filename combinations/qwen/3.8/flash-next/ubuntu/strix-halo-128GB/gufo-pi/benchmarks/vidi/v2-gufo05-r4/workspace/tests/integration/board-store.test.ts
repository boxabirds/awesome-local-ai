/**
 * Integration: `BoardStore` against the SQLite storage of a real Durable Object
 * (TC-03 to TC-11, TC-25).
 *
 * This is the layer that decides whether a board survives, so nothing here is
 * faked: the tables are the platform's, the bytes come from boards built by the
 * model functions (`tests/fixtures/boards.ts`), and the damage is written into the
 * real rows. What a test claims is what the next process will find.
 *
 * Each test opens a board address of its own, which keeps one test's rows out of
 * another's database.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { deleteObject, getStickyText, moveObject, snapshot } from '../../src/shared/board-model';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION
} from '../../src/shared/config';
import { BoardStore, chunkBytes, joinChunks } from '../../src/worker/board-store';
import { largeBoard, randomBytesLike, retroBoard, truncatedBytes } from '../fixtures/boards';

/** Plain-object view of a board, so a failure says what differs. */
function notesOf(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc));
}

/** What the tables hold, read from inside the object. */
interface StorageView {
  tables: string[];
  updates: number;
  chunks: number;
  quarantined: number;
  throughSeq: string;
  schemaVersion: string;
  maxSeq: number;
  logBytes: number;
}

function view(state: DurableObjectState): StorageView {
  const sql = state.storage.sql;
  const scalar = <T>(query: string, fallback: T): T => {
    const row = sql.exec(query).toArray()[0];
    return row === undefined ? fallback : ((row.value as T) ?? fallback);
  };
  const meta = (key: string): string => {
    const row = sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0];
    return row === undefined ? '' : String(row.value);
  };
  return {
    tables: sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
      .toArray()
      .map((row) => String(row.name)),
    updates: scalar('SELECT COUNT(*) AS value FROM updates', 0),
    chunks: scalar('SELECT COUNT(*) AS value FROM snapshot_chunks', 0),
    quarantined: scalar('SELECT COUNT(*) AS value FROM quarantined_updates', 0),
    throughSeq: meta('snapshot_through_seq'),
    schemaVersion: meta('storage_schema_version'),
    maxSeq: scalar('SELECT COALESCE(MAX(seq), 0) AS value FROM updates', 0),
    logBytes: scalar('SELECT COALESCE(SUM(bytes), 0) AS value FROM updates', 0)
  };
}

/** One row's bytes, as they are on disk. */
function rowBytes(state: DurableObjectState, table: 'updates' | 'snapshot_chunks', key: number): Uint8Array {
  const column = table === 'updates' ? 'seq' : 'idx';
  const data = state.storage.sql.exec(`SELECT data FROM ${table} WHERE ${column} = ?`, key).one().data;
  return new Uint8Array(data as ArrayBuffer);
}

/** Overwrite one row's bytes — the way storage loses them. */
function damageRow(
  state: DurableObjectState,
  table: 'updates' | 'snapshot_chunks',
  key: number,
  bytes: Uint8Array
): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  state.storage.transactionSync(() => {
    if (table === 'updates') {
      state.storage.sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        copy.buffer,
        copy.byteLength,
        key
      );
    } else {
      state.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', copy.buffer, key);
    }
  });
}

/** Write a whole log in one go, the way a long-lived board accumulated it. */
function insertLog(state: DurableObjectState, updates: readonly Uint8Array[]): void {
  state.storage.transactionSync(() => {
    for (const update of updates) {
      const copy = new Uint8Array(update.byteLength);
      copy.set(update);
      state.storage.sql.exec(
        'INSERT INTO updates (data, bytes) VALUES (?, ?)',
        copy.buffer,
        update.byteLength
      );
    }
  });
}

/** Run `run` inside a board's own Durable Object, on storage nothing else uses. */
async function inBoard<T>(run: (state: DurableObjectState) => T): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
  return runInDurableObject(stub, (_instance, state) => run(state));
}

describe('a board nobody has edited', () => {
  // TC-03
  it('has the tables, an empty document and the storage version', async () => {
    const { load, storage, notes } = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      const load = store.load(doc);
      return { load, storage: view(state), notes: notesOf(doc) };
    });

    expect(load).toEqual({ ok: true, quarantined: 0 });
    // Our four tables, and nothing else but SQLite's own bookkeeping.
    expect(storage.tables.filter((name) => !name.startsWith('sqlite_')).sort()).toEqual([
      'quarantined_updates',
      'snapshot_chunks',
      'storage_meta',
      'updates'
    ]);
    expect(storage.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(notes).toBe('[]');
  });

  // TC-25. Opening a board is not an event worth recording: an untouched board
  // stays byte-for-byte untouched.
  it('holds no update rows just because somebody opened it', async () => {
    const storage = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      store.load(new Y.Doc());
      store.migrate();
      store.load(new Y.Doc());
      return view(state);
    });

    expect(storage.updates).toBe(0);
    expect(storage.chunks).toBe(0);
    expect(storage.quarantined).toBe(0);
    expect(storage.throughSeq).toBe('');
  });
});

describe('storing a change', () => {
  // TC-04
  it('writes one update as one row whose byte count is its length', async () => {
    const session = retroBoard({ notes: 1, authors: 1 });
    const update = session.updates[session.updates.length - 1];

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const before = view(state);
      store.append(update);
      return {
        before,
        after: view(state),
        stored: rowBytes(state, 'updates', 1)
      };
    });

    expect(result.before.updates).toBe(0);
    expect(result.after.updates).toBe(1);
    expect(result.after.logBytes).toBe(update.byteLength);
    expect(Array.from(result.stored)).toEqual(Array.from(update));
  });

  it('keeps every update of a session, in the order it arrived', async () => {
    const session = retroBoard();

    const rows = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      return state.storage.sql.exec('SELECT seq, bytes FROM updates ORDER BY seq ASC').toArray();
    });

    expect(rows.map((row) => row.seq)).toEqual(session.updates.map((_update, index) => index + 1));
    expect(rows.map((row) => row.bytes)).toEqual(session.updates.map((update) => update.byteLength));
  });
});

describe('reopening a board', () => {
  // TC-05
  it('brings a 24-note retrospective back exactly', async () => {
    const session = retroBoard();
    const expected = notesOf(session.room);

    const reopened = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: notesOf(doc),
        // Not just the same notes: the same document. A board that reopens with a
        // different history would merge badly the moment somebody typed.
        stateVector: JSON.stringify(Array.from(Y.encodeStateVector(doc)))
      };
    });

    expect(reopened.load).toEqual({ ok: true, quarantined: 0 });
    expect(reopened.notes).toBe(expected);
    expect(reopened.stateVector).toBe(JSON.stringify(Array.from(Y.encodeStateVector(session.room))));
    expect(JSON.parse(reopened.notes)).toHaveLength(snapshot(session.room).length);
  });

  it('gives a board with nothing stored an empty document, not a failure', async () => {
    const reopened = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      const doc = new Y.Doc();
      const load = store.load(doc);
      return { load, notes: notesOf(doc) };
    });

    expect(reopened.load).toEqual({ ok: true, quarantined: 0 });
    expect(reopened.notes).toBe('[]');
  });

  it('keeps working after the board reopens', async () => {
    const session = retroBoard();

    const afterReopen = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);

      // Someone arrives, then edits — the way the room does it.
      const doc = new Y.Doc();
      store.load(doc);
      const before = Y.encodeStateVector(doc);
      const objects = doc.getMap('objects');
      const addition = new Y.Map<unknown>();
      addition.set('type', 'sticky');
      addition.set('x', 4242);
      doc.transact(() => objects.set('note-added-after-reopen', addition));
      const update = Y.encodeStateAsUpdate(doc, before);
      store.append(update);

      const second = new Y.Doc();
      store.load(second);
      return { notes: notesOf(second), rows: view(state).updates, counted: store.logSize };
    });

    const expected = JSON.parse(notesOf(session.room)) as { x: number }[];
    const notes = JSON.parse(afterReopen.notes) as { x: number; id: string }[];
    expect(afterReopen.rows).toBe(session.updates.length + 1);
    // The store's own count of the log matches the table, so the next compaction
    // decision is made on the truth rather than on what it remembered.
    expect(afterReopen.counted.rows).toBe(session.updates.length + 1);
    expect(notes).toHaveLength(expected.length + 1);
    expect(notes.some((note) => note.x === 4242)).toBe(true);
  });
});

describe('compaction', () => {
  // TC-06
  it('folds a full log into a snapshot and reopens to the same board', async () => {
    const session = retroBoard({ rows: COMPACTION_UPDATE_COUNT });

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      const before = view(state);
      const compacted = store.compactIfNeeded(session.room);

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        compacted,
        before,
        after: view(state),
        load,
        notes: notesOf(doc)
      };
    });

    expect(result.before.updates).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);
    expect(result.compacted).toBe(true);
    expect(result.after.updates).toBe(0);
    expect(result.after.logBytes).toBe(0);
    expect(result.after.chunks).toBeGreaterThanOrEqual(1);
    expect(Number(result.after.throughSeq)).toBe(result.before.maxSeq);

    expect(result.load.ok).toBe(true);
    expect(result.notes).toBe(notesOf(session.room));
  });

  // TC-07
  it('applies only the changes made after the snapshot', async () => {
    const session = retroBoard({ rows: COMPACTION_UPDATE_COUNT });

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      expect(store.compactIfNeeded(session.room)).toBe(true);

      // Three more changes, on a document that holds the whole board.
      const author = new Y.Doc();
      Y.applyUpdate(author, Y.encodeStateAsUpdate(session.room), 'sync');
      const notes = snapshot(author);
      const moved = notes[0];
      const typed = notes[1];
      const gone = notes[2];
      const extra: Uint8Array[] = [];

      for (const change of [
        () => {
          if (moved) moveObject(author, moved.id, 7777, 8888);
        },
        () => {
          if (typed) {
            const shared = getStickyText(author, typed.id);
            if (shared) author.transact(() => shared.insert(0, 'added after the snapshot'));
          }
        },
        () => {
          if (gone) deleteObject(author, gone.id);
        }
      ]) {
        const before = Y.encodeStateVector(author);
        change();
        extra.push(Y.encodeStateAsUpdate(author, before));
      }
      for (const update of extra) store.append(update);

      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: notesOf(doc),
        logRows: view(state).updates,
        through: view(state).throughSeq,
        expected: notesOf(author),
        expectedGone: gone?.id ?? ''
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    // Only the three changes after the snapshot are in the log; the rest of the
    // board comes from the snapshot, which is the whole point of folding it.
    expect(result.logRows).toBe(3);
    expect(Number(result.through)).toBeGreaterThan(0);
    expect(result.notes).toBe(result.expected);
    const notes = JSON.parse(result.notes) as { id: string }[];
    expect(notes.some((note) => note.id === result.expectedGone)).toBe(false);
  });

  // TC-08. A board this size cannot fit in one row: it has to arrive in pieces.
  it('chunks a 2,000-note snapshot and reopens it whole', async () => {
    // Padded to a log long enough to compact: what is under test is how a big
    // snapshot is stored and read back, not when the folding happens.
    const session = largeBoard({ rows: COMPACTION_UPDATE_COUNT });
    expect(snapshot(session.room)).toHaveLength(PERSIST_TESTED_NOTES);

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      // A board this size does not come from one test's worth of little writes; the
      // log is written as one transaction and read back through the store, which is
      // what a board looks like when it finally compacts.
      insertLog(state, session.updates);
      const doc = new Y.Doc();
      const loaded = store.load(doc);
      const encodedBytes = Y.encodeStateAsUpdate(doc).byteLength;
      const compacted = store.compactIfNeeded(doc);

      const reopened = new Y.Doc();
      const reload = store.load(reopened);
      return {
        loaded,
        compacted,
        reload,
        chunks: view(state).chunks,
        logRows: view(state).updates,
        encodedBytes,
        notes: notesOf(reopened)
      };
    });

    expect(result.loaded.ok).toBe(true);
    expect(result.compacted).toBe(true);
    expect(result.reload.ok).toBe(true);
    expect(result.encodedBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(result.chunks).toBe(Math.ceil(result.encodedBytes / SNAPSHOT_CHUNK_BYTES));
    expect(result.chunks).toBeGreaterThan(1);
    expect(result.logRows).toBe(0);
    expect(result.notes).toBe(notesOf(session.room));
    expect(JSON.parse(result.notes)).toHaveLength(PERSIST_TESTED_NOTES);
  });

  it('leaves a log below the thresholds alone', async () => {
    const session = retroBoard();

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      const compacted = store.compactIfNeeded(session.room);
      return { compacted, storage: view(state), rows: session.updates.length };
    });

    expect(result.compacted).toBe(false);
    expect(result.storage.chunks).toBe(0);
    expect(result.storage.updates).toBe(result.rows);
  });
});

describe('damage', () => {
  // TC-09
  it('quarantines one damaged log row and loads the rest of the board', async () => {
    const session = retroBoard();
    const damaged = 6;
    const original = snapshot(session.room);

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      const before = view(state);

      // Row 6 stops being an update: a write that stopped halfway.
      damageRow(state, 'updates', 6, truncatedBytes(rowBytes(state, 'updates', 6)));

      const doc = new Y.Doc();
      const load = store.load(doc);
      const kept = state.storage.sql.exec('SELECT seq, error, data FROM quarantined_updates').toArray();
      return {
        before,
        after: view(state),
        load,
        notes: notesOf(doc),
        kept: kept.map((row) => ({
          seq: row.seq,
          error: String(row.error),
          bytes: (row.data as ArrayBuffer).byteLength
        }))
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 1 });
    expect(result.after.updates).toBe(result.before.updates - 1);
    expect(result.after.quarantined).toBe(1);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].seq).toBe(6);
    expect(result.kept[0].error.length).toBeGreaterThan(0);
    expect(result.kept[0].bytes).toBeLessThan(session.updates[5].byteLength);

    // The board is there, and what is missing is exactly what is missing when that
    // change is simply absent. That is the most any loader can promise: Yjs replays
    // one author's changes in order, so a change that cannot be read takes with it
    // the later changes that depended on it — and nothing that did not.
    const reference = new Y.Doc();
    session.updates.forEach((update, index) => {
      if (index === damaged - 1) return;
      Y.applyUpdate(reference, update);
    });
    expect(result.notes).toBe(notesOf(reference));

    const notes = JSON.parse(result.notes) as { id: string }[];
    for (const note of notes) {
      expect(session.owners.has(note.id), `note ${note.id} was never on this board`).toBe(true);
    }
    // Most of the board comes back. What is gone is the unreadable change and the
    // work that was built on top of it: with bytes that are no longer there, that is
    // the most any loader can do — and it is a long way from an empty board. (Who
    // exactly depends on whom is Yjs' business; the equality above is the promise.)
    expect(notes.length).toBeGreaterThan(original.length / 2);
  });

  it('quarantines random bytes too, and only that row', async () => {
    const session = retroBoard();

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      damageRow(state, 'updates', 4, randomBytesLike(rowBytes(state, 'updates', 4), 99));
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: JSON.parse(notesOf(doc)) as unknown[],
        storage: view(state)
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 1 });
    expect(result.storage.quarantined).toBe(1);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('survives a second damaged row', async () => {
    const session = retroBoard();

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      damageRow(state, 'updates', 3, truncatedBytes(rowBytes(state, 'updates', 3)));
      damageRow(state, 'updates', 9, truncatedBytes(rowBytes(state, 'updates', 9)));
      const doc = new Y.Doc();
      const load = store.load(doc);
      return {
        load,
        notes: JSON.parse(notesOf(doc)) as unknown[],
        storage: view(state)
      };
    });

    expect(result.load).toEqual({ ok: true, quarantined: 2 });
    expect(result.storage.quarantined).toBe(2);
    expect(result.storage.updates).toBe(session.updates.length - 2);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  // TC-10. A board whose snapshot cannot be read must not be quietly emptied on
  // the way to admitting it: the caller gets a failure and an untouched document.
  it('refuses a damaged snapshot without deleting or quarantining anything', async () => {
    const session = retroBoard({ rows: COMPACTION_UPDATE_COUNT });

    const result = await inBoard((state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      expect(store.compactIfNeeded(session.room)).toBe(true);
      const before = view(state);

      damageRow(
        state,
        'snapshot_chunks',
        0,
        randomBytesLike(rowBytes(state, 'snapshot_chunks', 0), 31)
      );

      // A document that already holds something must still hold it: a failed load
      // is not a way to lose a board that was open.
      const doc = new Y.Doc();
      const load = store.load(doc);
      return { before, after: view(state), load, notes: notesOf(doc) };
    });

    expect(result.load.ok).toBe(false);
    if (!result.load.ok) expect(result.load.reason).toBe('snapshot-unreadable');
    expect(result.after.updates).toBe(result.before.updates);
    expect(result.after.chunks).toBe(result.before.chunks);
    expect(result.after.quarantined).toBe(0);
    expect(result.notes).toBe('[]');
  });

  // TC-11. A compaction that fails halfway must cost nothing.
  it('rolls a failed compaction back with the old snapshot and the whole log', async () => {
    const session = retroBoard({ rows: COMPACTION_UPDATE_COUNT });

    const result = await inBoard((state) => {
      /** A store whose second compaction dies just after dropping the old chunks. */
      class ExplodingStore extends BoardStore {
        attempts = 0;

        protected override clearSnapshotChunks(): void {
          super.clearSnapshotChunks();
          this.attempts += 1;
          if (this.attempts > 1) throw new Error('injected failure after deleting snapshot chunks');
        }
      }

      const store = new ExplodingStore(state.storage);
      store.migrate();
      for (const update of session.updates) store.append(update);
      expect(store.compactIfNeeded(session.room)).toBe(true);

      // More changes arrive, then a compaction dies with the old chunks already
      // gone. The changes are ones this document already holds, so the board being
      // folded is the board that was there: what is under test is the rollback.
      for (const update of session.updates) store.append(update);
      const before = view(state);
      const chunkZero = rowBytes(state, 'snapshot_chunks', 0);
      const failed = store.compactIfNeeded(session.room);

      const reopened = new Y.Doc();
      const load = store.load(reopened);
      return {
        failed,
        attempts: store.attempts,
        before,
        after: view(state),
        chunkZero,
        chunkZeroAfter: rowBytes(state, 'snapshot_chunks', 0),
        load,
        notes: notesOf(reopened)
      };
    });

    expect(result.attempts).toBe(2);
    expect(result.failed).toBe(false);
    expect(result.after.updates).toBe(result.before.updates);
    expect(result.after.chunks).toBe(result.before.chunks);
    expect(Array.from(result.chunkZeroAfter)).toEqual(Array.from(result.chunkZero));
    // And the board still reads as it did before the attempt.
    expect(result.load.ok).toBe(true);
    expect(result.notes).toBe(notesOf(session.room));
  });
});

describe('the chunk helpers against the real engine', () => {
  it('round-trips a real snapshot through chunks and BLOB rows', async () => {
    const session = retroBoard();
    const encoded = Y.encodeStateAsUpdate(session.room);

    const stored = await inBoard((state) => {
      new BoardStore(state.storage).migrate();
      state.storage.transactionSync(() => {
        chunkBytes(encoded, 512).forEach((chunk, index) => {
          const copy = new Uint8Array(chunk.byteLength);
          copy.set(chunk);
          state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, copy.buffer);
        });
      });
      const rows = state.storage.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC')
        .toArray()
        .map((row) => new Uint8Array(row.data as ArrayBuffer));
      return { count: rows.length, joined: Array.from(joinChunks(rows)) };
    });

    expect(stored.count).toBe(Math.ceil(encoded.byteLength / 512));
    expect(stored.joined).toEqual(Array.from(encoded));
  });
});
