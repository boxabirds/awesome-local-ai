/**
 * The storage layer against a real Durable Object SQLite database (TC-03 to TC-11,
 * TC-25). These run in workerd through `vitest-pool-workers`, and every statement
 * goes through the same synchronous SQLite API the room uses: an in-memory stand-in
 * would prove nothing about rows that are too big, transactions that roll back, or
 * what survives a reload.
 *
 * The store is reached with `runInDurableObject`, which runs the callback inside the
 * object, over that board's real database. What a test returns has to be plain data,
 * which is a useful constraint — it keeps the assertions about the board rather than
 * about objects.
 *
 * One arithmetic runs through this file: seeding `n` notes writes `2n + 1` rows of
 * the log — the change that started the document, then one change per note created
 * and one per text written. So the row that created note `k` is `2 + 2k`, and the one
 * that wrote its text is `3 + 2k`.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, PERSIST_TESTED_NOTES } from '../../src/shared/config.js';
import { newBoardId } from '../../src/shared/board-id.js';
import { snapshot } from '../../src/shared/board-model.js';
import { BoardStore, LOAD_ORIGIN, SNAPSHOT_THROUGH_SEQ_KEY, STORAGE_SCHEMA_VERSION_KEY } from '../../src/worker/board-store.js';
import { bigPersistTestedBoard, buildBoard, retroBoard, sameBoard } from '../fixtures/boards.js';
import type { LoadResult, SqlValue } from '../../src/worker/board-store.js';
import type { BoardRoom } from '../../src/worker/board-room.js';

/** What a test wants to know about a board. Plain data, so it can leave the object. */
type Facts = {
  load?: LoadResult;
  notes?: number;
  withText?: number;
  texts?: string[];
  colors?: string[];
  multiLine?: number;
  schemaVersion?: number;
  updateRows?: number;
  chunkRows?: number;
  chunkBytes?: number;
  quarantinedRows?: number;
  through?: string | null;
  loggedCount?: number;
  loggedBytes?: number;
  stateVector?: string;
};

/** A board nobody else uses, made fresh for each test. Rooms live on in the Worker
 * instance for the whole run, and these tests write rows, damage rows and roll
 * transactions back. */
const boardStub = () => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(newBoardId()));
let stub: ReturnType<typeof boardStub>;

beforeEach(() => {
  stub = boardStub();
});

/**
 * Run `fn` inside a board's Durable Object with a migrated store over its storage.
 * `make` stands for the store itself — the compaction test hands it one that fails.
 */
/** A board object's storage. `ctx` is protected on the class, and a test is not a
 * subclass — but reading and writing the real rows is the whole point here. */
const storageOf = (room: BoardRoom): DurableObjectStorage =>
  (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;

const withStore = <T>(
  fn: (store: BoardStore, storage: DurableObjectStorage) => T,
  make?: (storage: DurableObjectStorage) => BoardStore,
): Promise<T> =>
  runInDurableObject(stub, (room) => {
    const storage = storageOf(room);
    const store = make ? make(storage) : migrated(new BoardStore(storage));
    return fn(store, storage);
  });

const migrated = (store: BoardStore): BoardStore => {
  store.migrate();
  return store;
};

/** Run `fn` inside the object with its storage alone, for the test's own SQL. */
const inBoard = <T>(fn: (storage: DurableObjectStorage) => T): Promise<T> =>
  runInDurableObject(stub, (room) => fn(storageOf(room)));

const one = <T extends Record<string, SqlValue>>(
  storage: DurableObjectStorage,
  sql: string,
  ...bindings: SqlValue[]
): T => storage.sql.exec<T>(sql, ...bindings).toArray()[0] as T;

const countRows = (storage: DurableObjectStorage, table: string): number =>
  one<{ n: number }>(storage, `SELECT COUNT(*) AS n FROM ${table}`).n;

/** The board's state vector as a string, so two of them can be compared. */
const stateVectorOf = (doc: Y.Doc): string =>
  Array.from(Y.decodeStateVector(Y.encodeStateVector(doc)))
    .map(([client, clock]) => `${client}:${clock}`)
    .sort()
    .join(' ');

/**
 * A board of `notes` sticky notes, every change appended the way the room appends a
 * change it received. The notes come from `tests/fixtures/boards.ts`, built with the
 * client's own model calls, so the log holds what a real board's log holds: the
 * change that started the document, then a creation and a piece of text per note.
 */
function seed(store: BoardStore, notes: number, textBytes = 12): Y.Doc {
  const built = buildBoard(notes, {
    // Each note's text says which note it is, so a test can point at the one it
    // damaged rather than at "one of the twenty identical ones".
    text: (index) => 'x'.repeat(textBytes) + index,
    at: (index) => ({ x: index * 100, y: index % 3 }),
  });
  for (const update of built.updates) store.append(update);
  // And anything this test writes to the board afterwards goes into the log too,
  // which is what the room does with a change that arrives on a socket.
  built.doc.on('update', (update: Uint8Array) => store.append(update));
  return built.doc;
}

/**
 * The note a test means when it says "the third note": the notes in the order the
 * board acquired them. Their real ids are uuids, which is why a test asks by position.
 * A note whose creation row was damaged is not in the list at all, which is the truth.
 */
function noteMap(doc: Y.Doc, position: number): Y.Map<unknown> {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const ids = Array.from(objects.keys());
  const id = ids[position];
  const note = id === undefined ? undefined : objects.get(id);
  if (note === undefined) throw new Error(`this board has no note at position ${position}`);
  return note;
}

/**
 * The PRD's retro board: twenty-five notes in six colours, several with two lines,
 * laid over each other. Appended change by change, the way a board gets written.
 */
function seedRetro(store: BoardStore): Y.Doc {
  const built = retroBoard();
  for (const update of built.updates) store.append(update);
  return built.doc;
}

/**
 * What a document holds, as plain data: the notes read with the client's own model,
 * in a stable order so that two boards can be compared field by field.
 */
function factsOf(doc: Y.Doc): Pick<
  Facts,
  'notes' | 'withText' | 'texts' | 'colors' | 'multiLine' | 'stateVector' | 'schemaVersion'
> {
  // A copy, because the model hands out a readonly list and this wants them in
  // a different order than it returns them in.
  const notes = [...snapshot(doc)].sort((a, b) => a.id.localeCompare(b.id));
  return {
    notes: notes.length,
    withText: notes.filter((note) => note.text !== '').length,
    texts: notes.map((note) => note.text),
    colors: notes.map((note) => note.color),
    multiLine: notes.filter((note) => note.text.includes('\n')).length,
    stateVector: stateVectorOf(doc),
    schemaVersion: doc.getMap('meta').get('schemaVersion') as number | undefined,
  };
}

/** The board as it is in storage, read by a document that has never seen it. */
const boardAsStored = (): Promise<Facts> =>
  withStore((store, storage) => {
    const doc = new Y.Doc();
    const load = store.load(doc);
    return {
      load,
      ...factsOf(doc),
      updateRows: countRows(storage, 'updates'),
      chunkRows: countRows(storage, 'snapshot_chunks'),
      chunkBytes: one<{ bytes: number }>(
        storage,
        `SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_chunks`,
      ).bytes,
      quarantinedRows: countRows(storage, 'quarantined_updates'),
      through:
        storage.sql
          .exec<{ value: string }>(
            `SELECT value FROM storage_meta WHERE key = ?`,
            SNAPSHOT_THROUGH_SEQ_KEY,
          )
          .toArray()[0]?.value ?? null,
      loggedCount: store.updateCount(),
      loggedBytes: store.updateBytes(),
    };
  });

/** Overwrite a log row with rubbish, keeping a fraction of its bytes. */
const damageRow = (seq: number): Promise<unknown> =>
  inBoard((storage) => {
    const data = one<{ data: ArrayBuffer }>(storage, `SELECT data FROM updates WHERE seq = ?`, seq)
      .data;
    const original = new Uint8Array(data);
    const damaged = original.slice(0, Math.max(1, Math.floor(original.byteLength / 4)));
    for (let index = 0; index < damaged.byteLength; index += 1) {
      damaged[index] = (damaged[index] + 161) % 251;
    }
    storage.sql.exec(`UPDATE updates SET data = ? WHERE seq = ?`, damaged.buffer, seq);
    return { was: original.byteLength, now: damaged.byteLength };
  });

/** Overwrite a snapshot chunk with rubbish of the same length, and keep the original. */
const damageChunk = (idx: number): Promise<ArrayBuffer> =>
  inBoard((storage) => {
    const data = one<{ data: ArrayBuffer }>(
      storage,
      `SELECT data FROM snapshot_chunks WHERE idx = ?`,
      idx,
    ).data;
    const original = new Uint8Array(data).slice();
    const damaged = new Uint8Array(data.byteLength).fill(217);
    storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, damaged.buffer, idx);
    return original.buffer;
  });

/** Put a snapshot chunk back, which is what "quarantine, do not delete" makes possible. */
const restoreChunk = (idx: number, data: ArrayBuffer): Promise<unknown> =>
  inBoard((storage) => {
    storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, data, idx);
    return true;
  });

describe('migrate (TC-25)', () => {
  it('creates the tables and no update rows (TC-03, TC-25)', async () => {
    const facts = await withStore((store, storage) => ({
      updateRows: countRows(storage, 'updates'),
      chunkRows: countRows(storage, 'snapshot_chunks'),
      quarantinedRows: countRows(storage, 'quarantined_updates'),
      metaKeys: storage.sql
        .exec<{ key: string }>(`SELECT key FROM storage_meta ORDER BY key`)
        .toArray()
        .map((row) => row.key),
      version: store.schemaVersion(),
    }));
    expect(facts).toEqual({
      updateRows: 0,
      chunkRows: 0,
      quarantinedRows: 0,
      metaKeys: [STORAGE_SCHEMA_VERSION_KEY],
      version: 1,
    });
  });

  it('is idempotent: migrating the same board twice changes nothing (TC-25)', async () => {
    const twice = await withStore((store, storage) => {
      store.migrate();
      store.migrate();
      return countRows(storage, 'updates') + countRows(storage, 'snapshot_chunks');
    });
    expect(twice).toBe(0);
  });

  it('an empty board loads as an empty board, which is the truth (TC-03)', async () => {
    const facts = await boardAsStored();
    expect(facts).toMatchObject({
      load: { ok: true, quarantined: 0 },
      notes: 0,
      updateRows: 0,
      chunkRows: 0,
      through: null,
    });
  });
});

describe('append and load (TC-04, TC-05)', () => {
  it('appends two updates as two rows, in the order they happened (TC-04)', async () => {
    // Two real changes from a real board: the one that started the document, and the
    // one that created its first note.
    const built = buildBoard(2);
    const first = built.updates[0]!;
    const second = built.updates[1]!;

    const rows = await withStore((store, storage) => {
      store.append(first);
      store.append(second);
      const fresh = new Y.Doc();
      return {
        stored: storage.sql
          .exec<{ seq: number; bytes: number }>(`SELECT seq, bytes FROM updates ORDER BY seq`)
          .toArray(),
        logged: store.updateCount(),
        bytes: store.updateBytes(),
        load: store.load(fresh),
        notes: snapshot(fresh).length,
      };
    });

    // One row each, numbered from one, and each row's `bytes` is the length of the
    // change it holds rather than a guess about the board.
    expect(rows.stored).toEqual([
      { seq: 1, bytes: first.byteLength },
      { seq: 2, bytes: second.byteLength },
    ]);
    expect(rows.logged).toBe(2);
    expect(rows.bytes).toBe(first.byteLength + second.byteLength);
    expect(rows.load).toEqual({ ok: true, quarantined: 0 });
    // The second change is a note with no text on it yet: it is still a note.
    expect(rows.notes).toBe(1);
  });

  it('loads the PRD\u2019s retro board back with its colours, its multi-line notes and its overlaps (TC-05)', async () => {
    const seeded = await withStore((store) => {
      const doc = seedRetro(store);
      return { facts: factsOf(doc), notes: snapshot(doc) };
    });
    // The fixture is the board the story describes: twenty-five notes in six colours,
    // several of them carrying two lines, laid over each other.
    expect(seeded.facts.notes).toBe(25);
    expect(seeded.facts.withText).toBe(25);
    expect(new Set(seeded.facts.colors).size).toBe(6);
    expect(seeded.facts.multiLine).toBeGreaterThan(4);

    const stored = await withStore((store) => {
      const doc = new Y.Doc();
      return { load: store.load(doc), facts: factsOf(doc), notes: snapshot(doc) };
    });
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    // Not only the count: the same texts and the same colours, note for note.
    expect(stored.facts.texts).toEqual(seeded.facts.texts);
    expect(stored.facts.colors).toEqual(seeded.facts.colors);
    expect(stored.facts.multiLine).toBe(seeded.facts.multiLine);
    expect(stored.facts.stateVector).toBe(seeded.facts.stateVector);
    // And every field of every note: position, colour, text, stacking order.
    expect(sameBoard(stored.notes, seeded.notes)).toBe(true);
  });

  it('loads a thousand notes back into a document that has never seen them (TC-05)', async () => {
    const seeded = await withStore((store) => factsOf(seed(store, 1000)));
    expect(seeded.notes).toBe(1000);
    expect(seeded.withText).toBe(1000);

    const facts = await boardAsStored();
    expect(facts.load).toEqual({ ok: true, quarantined: 0 });
    expect(facts.notes).toBe(1000);
    expect(facts.withText).toBe(1000);
    expect(facts.texts).toEqual(seeded.texts);
    // One row per change: the document's own, then a creation and a text each.
    expect(facts.updateRows).toBe(2001);
    expect(facts.loggedCount).toBe(2001);
    expect(facts.quarantinedRows).toBe(0);
  });

  it('loads the same state again, and the log holds only what came after (TC-05)', async () => {
    const first = await withStore((store) => {
      const doc = seed(store, 1000);
      return { facts: factsOf(doc), vector: stateVectorOf(doc) };
    });

    // The same board read by a document that has never seen it — a load after a
    // restart, at this level — and then written to again.
    const again = await withStore((store, storage) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const loaded = factsOf(doc);
      // Reading the board back must not have changed what it is: the same clocks, the
      // same text, the same everything.
      const vector = stateVectorOf(doc);
      // A change from here on is written the way the room writes one.
      doc.on('update', (update, origin) => {
        if (origin !== LOAD_ORIGIN) store.append(update);
      });
      noteMap(doc, 0).set('color', 'lime');
      return { load, loaded, vector, rows: countRows(storage, 'updates') };
    });

    expect(again.load).toEqual({ ok: true, quarantined: 0 });
    expect(again.loaded).toEqual(first.facts);
    expect(again.vector).toBe(first.vector);
    // The change that arrived after the load is one new row, not a rewrite.
    expect(again.rows).toBe(2002);
  });
});

describe('compaction (TC-06, TC-07, TC-08)', () => {
  it('compacts the log once it holds 500 rows, and the board loads back from the snapshot (TC-06)', async () => {
    const outcome = await withStore((store) => {
      const doc = seed(store, 249); // 499 rows: one short of the threshold
      const below = store.compactIfNeeded(doc);
      // One more change, and it is on the threshold.
      doc.getMap('meta').set('edited', 2);
      return { below, compacted: store.compactIfNeeded(doc), logged: store.updateCount() };
    });
    expect(outcome).toEqual({ below: false, compacted: true, logged: 0 });

    const facts = await boardAsStored();
    expect(facts).toMatchObject({
      load: { ok: true, quarantined: 0 },
      notes: 249,
      withText: 249,
      schemaVersion: 1,
      // The log is empty, the snapshot says it covers every row there was.
      updateRows: 0,
      chunkRows: 1,
      through: '500',
      loggedCount: 0,
    });
  });

  it('compacts on the byte total alone, with rows to spare (TC-06)', async () => {
    const bytes = await withStore((store) => {
      // 100 notes of 45 000 characters: past 4 MiB while staying under 500 rows, so
      // it is the size of the log that triggers this and nothing else.
      const doc = seed(store, 100, 45_000);
      const rows = store.updateCount();
      const size = store.updateBytes();
      return { compacted: store.compactIfNeeded(doc), rows, size, logged: store.updateCount() };
    });
    expect(bytes.rows).toBe(201);
    expect(bytes.rows).toBeLessThan(COMPACTION_UPDATE_COUNT);
    expect(bytes.size).toBeGreaterThan(4 * 1024 * 1024);
    expect(bytes.compacted).toBe(true);
    expect(bytes.logged).toBe(0);

    const facts = await boardAsStored();
    expect(facts).toMatchObject({
      load: { ok: true, quarantined: 0 },
      notes: 100,
      withText: 100,
      updateRows: 0,
    });
  });

  it('keeps the board identical across a load that follows a compaction (TC-07)', async () => {
    const before = await withStore((store) => {
      const doc = seed(store, 300);
      expect(store.compactIfNeeded(doc)).toBe(true);
      // A change after the compaction: the log starts filling up again.
      noteMap(doc, 7).set('color', 'pink');
      return {
        facts: factsOf(doc),
        vector: stateVectorOf(doc),
        through: store.snapshotThroughSeq(),
      };
    });

    const after = await boardAsStored();
    expect(after).toMatchObject({
      load: { ok: true, quarantined: 0 },
      updateRows: 1,
      chunkRows: 1,
      through: String(before.through),
    });
    expect(after.texts).toEqual(before.facts.texts);
    expect(after.stateVector).toBe(before.vector);
  });

  it('writes a big snapshot in rows that are each small enough to store (TC-08)', async () => {
    const seeded = await withStore((store) => {
      // The board the story is measured with - two thousand notes with text on them -
      // which encodes to more than one chunk's worth of bytes.
      const built = bigPersistTestedBoard();
      for (const update of built.updates) store.append(update);
      const encoded = Y.encodeStateAsUpdate(built.doc).byteLength;
      expect(store.compactIfNeeded(built.doc)).toBe(true);
      return {
        rows: store.updateCount(),
        bytes: store.updateBytes(),
        encoded,
        facts: factsOf(built.doc),
        notes: snapshot(built.doc),
      };
    });
    expect(seeded.rows).toBe(0); // folded into the snapshot
    expect(seeded.encoded).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);
    expect(seeded.facts.notes).toBe(PERSIST_TESTED_NOTES);

    const stored = await withStore((store) => {
      const doc = new Y.Doc();
      return { load: store.load(doc), facts: factsOf(doc), notes: snapshot(doc) };
    });
    expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    expect(stored.facts.notes).toBe(PERSIST_TESTED_NOTES);
    expect(stored.facts.withText).toBe(PERSIST_TESTED_NOTES);
    expect(sameBoard(stored.notes, seeded.notes)).toBe(true);
    // The log is empty: the whole board is in the snapshot now.
    expect(stored.facts.stateVector).toBe(seeded.facts.stateVector);

    const rows = await boardAsStored();
    expect(rows.updateRows).toBe(0);
    // More than one chunk row, because the snapshot is bigger than a row may hold.
    expect(rows.chunkRows).toBeGreaterThan(1);
    expect(rows.chunkBytes).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const chunks = await inBoard((storage) =>
      storage.sql
        .exec<{ bytes: number }>(`SELECT LENGTH(data) AS bytes FROM snapshot_chunks ORDER BY idx`)
        .toArray(),
    );
    expect(rows.chunkRows).toBe(chunks.length);
    for (const chunk of chunks) expect(chunk.bytes).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    // The last row carries the remainder, and only the remainder.
    const full = Math.floor(seeded.encoded / SNAPSHOT_CHUNK_BYTES);
    expect(chunks.length).toBe(full + 1);
    expect(chunks[chunks.length - 1]?.bytes).toBe(seeded.encoded - full * SNAPSHOT_CHUNK_BYTES);
  });

  it('rolls a failed compaction back with the snapshot and the log intact (TC-11)', async () => {
    /** A store whose write fails just after the log was truncated, mid-transaction. */
    class FailingStore extends BoardStore {
      protected override exec(sql: string, ...bindings: SqlValue[]): void {
        super.exec(sql, ...bindings);
        if (sql.startsWith('DELETE FROM updates')) {
          throw new Error('injected failure after the chunks were replaced');
        }
      }
    }

    // A board that has been compacted once, so there is a snapshot to preserve.
    const before = await withStore((store) => {
      const doc = seed(store, 250);
      expect(store.compactIfNeeded(doc)).toBe(true);
      return factsOf(doc);
    });
    const snapshotBefore = await withStore((_store, storage) => ({
      chunkRows: countRows(storage, 'snapshot_chunks'),
      chunkBytes: one<{ bytes: number }>(
        storage,
        `SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_chunks`,
      ).bytes,
      through: one<{ value: string }>(
        storage,
        `SELECT value FROM storage_meta WHERE key = ?`,
        SNAPSHOT_THROUGH_SEQ_KEY,
      ).value,
    }));

    const outcome = await withStore(
      (store, storage) => {
        const doc = new Y.Doc();
        expect(store.load(doc).ok).toBe(true);
        // From here on this document's changes are written, as the room writes them —
        // and only its own, not the ones the load just applied.
        doc.on('update', (update, origin) => {
          if (origin !== LOAD_ORIGIN) store.append(update);
        });
        // Fill the log past the threshold again, then try to compact it.
        for (let round = 0; round < 500; round += 1) {
          noteMap(doc, 3).set('x', round);
        }
        const compacted = store.compactIfNeeded(doc);
        return {
          compacted,
          logged: store.updateCount(),
          updateRows: countRows(storage, 'updates'),
          chunkRows: countRows(storage, 'snapshot_chunks'),
          chunkBytes: one<{ bytes: number }>(
            storage,
            `SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_chunks`,
          ).bytes,
          through: one<{ value: string }>(
            storage,
            `SELECT value FROM storage_meta WHERE key = ?`,
            SNAPSHOT_THROUGH_SEQ_KEY,
          ).value,
          quarantinedRows: countRows(storage, 'quarantined_updates'),
        };
      },
      (storage) => new FailingStore(storage),
    );

    expect(outcome.compacted).toBe(false);
    // The snapshot this board had is the snapshot it still has, and the log kept the
    // rows it was trying to fold away: nothing was half-written.
    expect(outcome.chunkRows).toBe(snapshotBefore.chunkRows);
    expect(outcome.chunkBytes).toBe(snapshotBefore.chunkBytes);
    expect(outcome.through).toBe(snapshotBefore.through);
    expect(outcome.updateRows).toBe(500);
    expect(outcome.logged).toBe(500);
    expect(outcome.quarantinedRows).toBe(0);

    // The board is still the board, and it compacts next time round.
    const after = await withStore((store, storage) => {
      const doc = new Y.Doc();
      const load = store.load(doc);
      const facts = factsOf(doc);
      const compacted = store.compactIfNeeded(doc);
      return { load, facts, compacted, updateRows: countRows(storage, 'updates') };
    });
    expect(after.load).toEqual({ ok: true, quarantined: 0 });
    // The board is still the board: 250 notes, each with its text.
    expect(after.facts.notes).toBe(before.notes);
    expect(after.facts.withText).toBe(before.withText);
    expect(after.compacted).toBe(true);
    expect(after.updateRows).toBe(0);
  });
});

describe('damage (TC-09, TC-10)', () => {
  it('loses one damaged change and nothing else (TC-09)', async () => {
    const seeded = await withStore((store) => factsOf(seed(store, 20)));
    expect(seeded.withText).toBe(20);
    await damageRow(3 + 2 * 9); // the change that wrote note 9's text

    const facts = await boardAsStored();
    expect(facts.load).toEqual({ ok: true, quarantined: 1 });
    // Every note is there; only the damaged change is missing.
    expect(facts.notes).toBe(20);
    expect(facts.withText).toBe(19);
    // Both boards are listed in the same order (by note id), so this says exactly which
    // note lost what: one came back with no text, and it is the one whose row was
    // damaged - note 9, whose text was twelve characters and a nine.
    const was = seeded.texts!;
    const changed = facts.texts!.map((text, index) =>
      text === was[index] ? null : { was: was[index], now: text },
    );
    expect(changed.filter((change) => change !== null)).toHaveLength(1);
    expect(changed.filter((c) => c !== null)).toEqual([{ was: 'x'.repeat(12) + 9, now: '' }]);
    // The row is out of the log and into the quarantine, where the cause is kept.
    expect(facts.updateRows).toBe(40);
    expect(facts.quarantinedRows).toBe(1);

    const reason = await inBoard(
      (storage) => one<{ error: string }>(storage, `SELECT error FROM quarantined_updates`).error,
    );
    expect(reason).not.toBe('');

    // Loading it again quarantines nothing: the damage was dealt with once, and the
    // board does not get worse every time somebody opens it.
    const again = await boardAsStored();
    expect(again.load).toEqual({ ok: true, quarantined: 0 });
    expect(again.notes).toBe(20);
    expect(again.withText).toBe(19);
  });

  it('loads a thousand notes when a row in the middle of the log cannot be decoded (TC-09)', async () => {
    const seeded = await withStore((store) => factsOf(seed(store, 1000)));
    expect(seeded.notes).toBe(1000);

    await damageRow(2 + 2 * 500); // the change that created note 500

    const facts = await boardAsStored();
    expect(facts.load).toEqual({ ok: true, quarantined: 1 });
    // The board behind the damage is all there: 999 of the 1000 notes, each with the
    // text it had, and note 500 the one thing missing.
    expect(facts.notes).toBe(999);
    expect(facts.withText).toBe(999);
    expect(facts.updateRows).toBe(2000);
    expect(facts.quarantinedRows).toBe(1);

    const again = await boardAsStored();
    expect(again.load).toEqual({ ok: true, quarantined: 0 });
    expect(again.notes).toBe(999);
  });

  it('damages the first row of the log and still loads the whole board (TC-09)', async () => {
    const seeded = await withStore((store) => factsOf(seed(store, 20)));
    await damageRow(1); // the very first change the board ever had

    const facts = await boardAsStored();
    expect(facts.load).toEqual({ ok: true, quarantined: 1 });
    // Everything that came after the damaged change is there — which it would not be
    // if the gap it left had not been closed.
    expect(facts.notes).toBe(20);
    expect(facts.withText).toBe(20);
    // The one thing that went is the change itself.
    expect(facts.schemaVersion).toBeUndefined();
    expect(seeded.schemaVersion).toBe(1);

    // The first change that a note depends on: that note is gone, and the nineteen
    // behind it are not.
    await damageRow(2 + 2 * 0);
    const worse = await boardAsStored();
    expect(worse.load).toEqual({ ok: true, quarantined: 1 });
    expect(worse.notes).toBe(19);
    expect(worse.withText).toBe(19);

    // And the board is stable: another load, same result, nothing further lost.
    const again = await boardAsStored();
    expect(again.load).toEqual({ ok: true, quarantined: 0 });
    expect(again.notes).toBe(19);
    expect(again.stateVector).toBe(worse.stateVector);

    // A change made now is written, and survives being loaded again afterwards.
    const written = await withStore((store) => {
      const doc = new Y.Doc();
      store.load(doc);
      noteMap(doc, 1).set('color', 'lime');
      return store.updateCount();
    });
    expect(written).toBeGreaterThan(0);
    const later = await boardAsStored();
    expect(later.load).toEqual({ ok: true, quarantined: 0 });
    expect(later.notes).toBe(19);
    expect(later.withText).toBe(19);
  });

  it('reports an unreadable snapshot and destroys nothing (TC-10)', async () => {
    await withStore((store) => {
      const doc = seed(store, 300);
      expect(store.compactIfNeeded(doc)).toBe(true);
      return true;
    });
    const original = await damageChunk(0);

    const facts = await boardAsStored();
    // The honest answer: this board could not be read. Not an empty board.
    expect(facts.load).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    expect(facts.notes).toBe(0);
    expect(facts.withText).toBe(0);

    // Nothing was deleted or moved out of the way in the process: a snapshot chunk is
    // most of the board, and repairing it is still possible.
    expect(facts).toMatchObject({ updateRows: 0, chunkRows: 1, quarantinedRows: 0 });

    const repaired = await restoreChunk(0, original).then(boardAsStored);
    expect(repaired.load).toEqual({ ok: true, quarantined: 0 });
    expect(repaired.notes).toBe(300);
    expect(repaired.withText).toBe(300);
  });

  it('lets a damaged snapshot win over a log row that is also damaged (TC-10)', async () => {
    // A board with both kinds of damage. The snapshot is the one that decides the
    // answer, because the rows behind it cannot be applied to a board that was never
    // read into a document.
    await withStore((store) => {
      const doc = seed(store, 300);
      store.compactIfNeeded(doc);
      // One change after the snapshot, so the log has a row of its own to damage.
      noteMap(doc, 5).set('color', 'lime');
      return store.updateCount();
    });
    await damageChunk(0);
    await damageRow(602);

    const facts = await boardAsStored();
    expect(facts.load).toMatchObject({ ok: false, reason: 'snapshot-unreadable' });
    // The row is still in the log, untouched: quarantining it would have been a
    // decision taken about a board that was never loaded.
    expect(facts.quarantinedRows).toBe(0);
    expect(facts.updateRows).toBe(1);
  });
});
