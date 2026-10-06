/**
 * Integration tests for `persist.board_store` (TC-03 to TC-11, TC-25).
 *
 * These run against a real Durable Object, so `ctx.storage.sql` is the real
 * SQLite-backed storage the product uses: real tables, real transactions, real
 * rollback. Each test uses its own board name, which is its own Durable Object
 * and therefore its own database.
 *
 * Injected failures are real SQL (`RAISE(ABORT)` triggers), never a wrapper
 * around the store — see NOTES.md.
 */

import * as Y from "yjs";
import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { BoardStore, type StoreState } from "../../src/worker/board-store";
import { stickySnapshot, snapshot, type StickySnapshot } from "../../src/shared/board-model";
import {
  BOARD_LOAD_BUDGET_MS,
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from "../../src/shared/config";
import { damagedVariants, largeBoard, retroBoard, seededEdits } from "../fixtures/boards";

/** Facts read straight out of SQLite, without going through the store. */
interface TableFacts {
  updateRows: number;
  updateBytes: number;
  chunkRows: number;
  chunkBytes: number;
  maxSeq: number;
  quarantinedRows: number;
  dbSize: number;
  snapshotThroughSeq: string | null;
  schemaVersion: string | null;
}

async function inBoard<T>(
  boardName: string,
  run: (store: BoardStore, storage: DurableObjectStorage) => T,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardName));
  return runInDurableObject(stub, (instance) => {
    const storage = (instance as unknown as { ctx: DurableObjectState }).ctx.storage;
    return run(new BoardStore(storage), storage);
  });
}

async function facts(boardName: string): Promise<TableFacts> {
  return inBoard(boardName, (_store, storage) => {
    const sql = storage.sql;
    const one = (query: string): number => Number(sql.exec(query).one()["n"] ?? 0);
    const meta = (key: string): string | null => {
      const cursor = sql.exec("SELECT value FROM storage_meta WHERE key = ?", key);
      const row = cursor.next();
      if (row === undefined || row.done === true || row.value === undefined) return null;
      return String(row.value["value"] ?? null);
    };
    return {
      updateRows: one("SELECT COUNT(*) AS n FROM updates"),
      updateBytes: one("SELECT COALESCE(SUM(bytes), 0) AS n FROM updates"),
      chunkRows: one("SELECT COUNT(*) AS n FROM snapshot_chunks"),
      chunkBytes: one("SELECT COALESCE(SUM(length(data)), 0) AS n FROM snapshot_chunks"),
      maxSeq: one("SELECT COALESCE(MAX(seq), 0) AS n FROM updates"),
      quarantinedRows: one("SELECT COUNT(*) AS n FROM quarantined_updates"),
      dbSize: sql.databaseSize,
      snapshotThroughSeq: meta("snapshot_through_seq"),
      schemaVersion: meta("storage_schema_version"),
    };
  });
}

/**
 * Appends a log the way `BoardRoom` does: each change is applied to the document
 * and the row is written from that document, so rows carry the store's look-back.
 */
function appendThroughDoc(store: BoardStore, updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) {
    Y.applyUpdate(doc, update);
    store.append(update, doc);
  }
  return doc;
}

/**
 * Replaces one stored row with `damage`, exactly as a damaged row arrives in
 * real storage: the log keeps its shape, the bytes stop being board content.
 */
async function corruptStoredRow(
  boardName: string,
  seq: number,
  damage: Uint8Array,
): Promise<void> {
  await inBoard(boardName, (_store, storage) => {
    storage.sql.exec(
      "UPDATE updates SET data = ?, bytes = ? WHERE seq = ?",
      damage.slice().buffer,
      damage.byteLength,
      seq,
    );
  });
}

/** The `seq` values stored in the log, oldest first. */
async function logSeqs(boardName: string): Promise<number[]> {
  return inBoard(boardName, (_store, storage) =>
    storage.sql.exec("SELECT seq FROM updates ORDER BY seq").toArray().map((row) => Number(row["seq"])),
  );
}

/** Installs a `RAISE(ABORT)` trigger, runs `body`, then removes it. */
async function withInjectedFailure<T>(
  boardName: string,
  trigger: string,
  body: () => Promise<T>,
): Promise<T> {
  await inBoard(boardName, (_store, storage) => storage.sql.exec(trigger));
  try {
    return await body();
  } finally {
    await inBoard(boardName, (_store, storage) =>
      storage.sql.exec("DROP TRIGGER IF EXISTS injected_failure"),
    );
  }
}

const noteText = (note: StickySnapshot): string => note.text ?? "";

describe("board storage migration (TC-03, TC-25)", () => {
  const board = "store-migration";

  it("a fresh board has the tables, no rows, and version 1", async () => {
    const result = await inBoard(board, (store, storage) => {
      store.migrate();
      const tables = storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .toArray()
        .map((row) => row["name"]);
      const emptyDoc = new Y.Doc();
      return { tables, load: store.load(emptyDoc), notes: snapshot(emptyDoc).length };
    });

    expect(result.tables).toEqual(
      expect.arrayContaining(["quarantined_updates", "snapshot_chunks", "storage_meta", "updates"]),
    );
    expect(result.load).toEqual({ ok: true, quarantined: 0 });
    expect(result.notes).toBe(0);

    const tableFacts = await facts(board);
    expect(tableFacts.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(tableFacts.updateRows).toBe(0);
    expect(tableFacts.chunkRows).toBe(0);
    expect(tableFacts.quarantinedRows).toBe(0);
    expect(tableFacts.snapshotThroughSeq).toBeNull();
  });

  it("migrate is idempotent and keeps existing rows", async () => {
    const fixture = retroBoard(3);
    const first = await inBoard(board, (store) => {
      store.migrate();
      appendThroughDoc(store, fixture.updates);
      return store.state();
    });
    expect(first.logRows).toBe(fixture.updates.length);

    const after = await inBoard(board, (store) => {
      store.migrate();
      store.migrate();
      return facts(board);
    });
    expect((await facts(board)).updateRows).toBe(fixture.updates.length);
    expect(after.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
  });
});

describe("round trip (TC-04)", () => {
  it("25 notes with mixed colours, multi-line text and stacking survive a reload field by field", async () => {
    const board = "store-round-trip";
    const fixture = retroBoard(25);

    await inBoard(board, (store) => appendThroughDoc(store, fixture.updates));

    const stored = await facts(board);
    expect(stored.updateRows).toBe(fixture.updates.length);

    const loaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });

    expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.notes.length).toBe(fixture.notes.length);
    expect(loaded.notes).toEqual(fixture.notes);

    const byStackOrder = [...loaded.notes].sort((a, b) => a.z - b.z);
    const expectedOrder = [...fixture.notes].sort((a, b) => a.z - b.z);
    for (const [index, note] of byStackOrder.entries()) {
      const expected = expectedOrder[index]!;
      expect([note.id, note.text, note.color, note.x, note.y, note.createdAt, note.z]).toEqual([
        expected.id,
        expected.text,
        expected.color,
        expected.x,
        expected.y,
        expected.createdAt,
        expected.z,
      ]);
      expect(noteText(note).includes("\n")).toBe(noteText(expected).includes("\n"));
    }
  });

  it("a reload sees the same board after an update is appended in between", async () => {
    const board = "store-round-trip-edit";
    const fixture = retroBoard(6);
    await inBoard(board, (store) => appendThroughDoc(store, fixture.updates));

    const edited = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      const [edit] = seededEdits(doc, 1);
      store.append(edit!, doc);
      return stickySnapshot(doc);
    });

    const reloaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      store.load(doc);
      return stickySnapshot(doc);
    });
    expect(reloaded).toEqual(edited);
  });
});

describe("a damaged log row (TC-05)", () => {
  /**
   * Writes the fixture as a real log (each change applied to the document and
   * stored, in order), then damages the row that holds the update at
   * `damagedIndex` — the shape of the failure the PRD describes rather than a
   * row that was never written.
   */
  const writeBoardAndDamage = async (
    boardName: string,
    fixture: { updates: Uint8Array[] },
    damage: Uint8Array,
    damagedIndices: readonly number[],
  ): Promise<{ damagedSeqs: number[] }> => {
    await inBoard(boardName, (store) => {
      const doc = new Y.Doc();
      const seqs: number[] = [];
      for (const [index, update] of fixture.updates.entries()) {
        Y.applyUpdate(doc, update);
        store.append(update, doc);
        if (damagedIndices.includes(index)) {
          seqs.push(Number(store.state().logRows));
        }
      }
      return seqs;
    });
    // One row per update, in order, so the row holding `updates[index]` is the
    // (`index` + 1)-th sequence number.
    const seqs = await logSeqs(boardName);
    for (const index of damagedIndices) {
      const seq = seqs[index];
      if (seq === undefined) throw new Error(`no log row for update ${index}`);
      await corruptStoredRow(boardName, seq, damage);
    }
    return { damagedSeqs: damagedIndices.map((index) => seqs[index]!) };
  };

  it("random bytes in a stored row are quarantined and the rest of the board loads", async () => {
    const board = "store-damaged-random";
    const fixture = retroBoard(20);
    const damagedIndex = 11;
    const damage = damagedVariants(fixture.updates[damagedIndex]!).randomBytes;

    const { damagedSeqs } = await writeBoardAndDamage(board, fixture, damage, [damagedIndex]);

    const loaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });

    expect(loaded.result).toEqual({ ok: true, quarantined: 1 });

    const tableFacts = await facts(board);
    expect(tableFacts.quarantinedRows).toBe(1);
    // The damaged row is the only row the log lost.
    expect(tableFacts.updateRows).toBe(fixture.updates.length - 1);

    const quarantined = await inBoard(board, (_store, storage) => {
      const row = storage.sql
        .exec("SELECT seq, length(data) AS len, error FROM quarantined_updates")
        .one();
      return { seq: Number(row["seq"]), len: Number(row["len"]), error: String(row["error"]) };
    });
    expect(quarantined.seq).toBe(damagedSeqs[0]);
    expect(quarantined.len).toBe(damage.byteLength);
    expect(quarantined.error.length).toBeGreaterThan(0);

    // The board reads as the board: every note is there and nothing else is.
    // The damaged row's own bytes contributed nothing; the change it carried
    // arrives through the next row's look-back (see `LOG_LOOKBACK_ROWS`).
    const texts = loaded.notes.map(noteText);
    const fixtureTexts = fixture.notes.map(noteText);
    expect(texts.length).toBe(fixtureTexts.length);
    for (const text of fixtureTexts) expect(texts).toContain(text);
    for (const text of texts) expect(fixtureTexts).toContain(text);

    // A later load does not quarantine anything: the damaged row is gone for good.
    const again = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(again.result).toEqual({ ok: true, quarantined: 0 });
    expect(again.notes).toEqual(loaded.notes);
  });

  it("a truncated stored row is quarantined the same way", async () => {
    const board = "store-damaged-truncated";
    const fixture = retroBoard(15);
    const damagedIndex = 8;
    const damage = damagedVariants(fixture.updates[damagedIndex]!).truncated;

    await writeBoardAndDamage(board, fixture, damage, [damagedIndex]);

    const loaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });

    expect(loaded.result).toEqual({ ok: true, quarantined: 1 });
    const texts = loaded.notes.map(noteText);
    for (const note of fixture.notes) expect(texts).toContain(noteText(note));
    expect(texts.length).toBe(fixture.notes.length);
    expect((await facts(board)).quarantinedRows).toBe(1);
  });

  it("damage wider than the look-back is quarantined without damaging what survives", async () => {
    // The tolerance is `LOG_LOOKBACK_ROWS - 1` consecutive rows. With two damaged
    // rows in a row the log has a hole nothing repeats over: the load must still
    // succeed, quarantine both rows, and put no garbage in the document.
    const board = "store-damaged-wide";
    const fixture = retroBoard(20);
    const damage = damagedVariants(fixture.updates[11]!).randomBytes;

    await writeBoardAndDamage(board, fixture, damage, [11, 12]);

    const loaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });

    expect(loaded.result).toEqual({ ok: true, quarantined: 2 });
    expect((await facts(board)).quarantinedRows).toBe(2);

    // Nothing damaged is in the document, everything written before the damaged
    // rows is, and nothing after them pretends to be.
    const texts = loaded.notes.map(noteText);
    const fixtureTexts = fixture.notes.map(noteText);
    for (const text of texts) expect(fixtureTexts).toContain(text);
    // Each row repeats the row before it, so a pair of damaged rows loses the
    // notes only those two rows carried: everything before them survives.
    for (const note of fixture.notes.slice(0, 10)) expect(texts).toContain(noteText(note));
    expect(texts.length).toBeLessThan(fixtureTexts.length);
  });
});

describe("compaction (TC-06)", () => {
  const board = "store-compaction";

  it("500 log rows compact to a chunked snapshot with an empty log, then the board still reloads", async () => {
    const fixture = retroBoard(25);
    const edits = seededEdits(fixture.doc, COMPACTION_UPDATE_COUNT - fixture.updates.length);
    const allUpdates = [...fixture.updates, ...edits];
    expect(allUpdates.length).toBe(COMPACTION_UPDATE_COUNT);

    const beforeCompaction = await inBoard(board, (store) => {
      appendThroughDoc(store, allUpdates);
      return facts(board);
    });
    expect(beforeCompaction.updateRows).toBe(COMPACTION_UPDATE_COUNT);

    const compacted = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      const expected = stickySnapshot(doc);
      const didCompact = store.compactIfNeeded(doc);
      return { didCompact, expected, state: store.state() };
    });
    expect(compacted.didCompact).toBe(true);

    const after = await facts(board);
    expect(after.updateRows).toBe(0);
    expect(after.chunkRows).toBeGreaterThanOrEqual(1);
    expect(after.snapshotThroughSeq).toBe(String(beforeCompaction.maxSeq));

    const reloaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(reloaded.result.ok).toBe(true);
    expect(reloaded.notes).toEqual(compacted.expected);

    // One more note added after compaction reloads too.
    const withExtra = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      const [edit] = seededEdits(doc, 1);
      store.append(edit!, doc);
      return stickySnapshot(doc);
    });
    expect(withExtra.length).toBe(compacted.expected.length);

    const finalReload = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(finalReload.notes).toEqual(withExtra);
    expect((await facts(board)).updateRows).toBe(1);
  });
});

describe("snapshot chunking (TC-07)", () => {
  const board = "store-chunked-snapshot";

  it("a snapshot larger than SNAPSHOT_CHUNK_BYTES becomes multiple rows, each under the limit", async () => {
    const fixture = largeBoard(PERSIST_TESTED_NOTES);
    expect(Y.encodeStateAsUpdate(fixture.doc).byteLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const compacted = await inBoard(board, (store) => {
      appendThroughDoc(store, fixture.updates);
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      const expected = stickySnapshot(doc);
      const encodedBytes = Y.encodeStateAsUpdate(doc).byteLength;
      const didCompact = store.compactIfNeeded(doc);
      return { didCompact, expected, state: store.state(), encodedBytes };
    });
    expect(compacted.didCompact).toBe(true);
    expect(compacted.state.snapshotChunks).toBeGreaterThanOrEqual(2);

    const chunkSizes = await inBoard(board, (_store, storage) =>
      storage.sql
        .exec("SELECT idx, length(data) AS len FROM snapshot_chunks ORDER BY idx")
        .toArray()
        .map((row) => Number(row["len"])),
    );
    expect(chunkSizes.length).toBeGreaterThanOrEqual(2);
    for (const size of chunkSizes) {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
    // The chunks are the snapshot, split: nothing added, nothing lost.
    expect(chunkSizes.reduce((total, size) => total + size, 0)).toBe(compacted.encodedBytes);
    expect(chunkSizes.length).toBe(Math.ceil(compacted.encodedBytes / SNAPSHOT_CHUNK_BYTES));

    const reloaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(reloaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(reloaded.notes).toEqual(compacted.expected);
    expect(reloaded.notes.length).toBe(PERSIST_TESTED_NOTES);
  });
});

describe("the board size the PRD names (TC-08, TC-09)", () => {
  const board = "store-large-board";

  it("2000 notes reload identically, stay under COMPACTION_BYTES on disk, and load within the budget", async () => {
    const fixture = largeBoard(PERSIST_TESTED_NOTES);

    const appended = await inBoard(board, (store) => {
      appendThroughDoc(store, fixture.updates);
      return facts(board);
    });
    expect(appended.updateRows).toBe(fixture.updates.length);
    expect(appended.updateRows).toBeGreaterThanOrEqual(COMPACTION_UPDATE_COUNT);

    const compacted = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      const expected = stickySnapshot(doc);
      const didCompact = store.compactIfNeeded(doc);
      return { didCompact, expected };
    });
    expect(compacted.didCompact).toBe(true);

    const after = await facts(board);
    expect(after.updateRows).toBe(0);
    expect(after.dbSize).toBeLessThan(COMPACTION_BYTES);

    const started = Date.now();
    const loaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    const elapsedMs = Date.now() - started;

    expect(loaded.result).toEqual({ ok: true, quarantined: 0 });
    expect(loaded.notes.length).toBe(PERSIST_TESTED_NOTES);
    expect(loaded.notes).toEqual(compacted.expected);
    expect(elapsedMs).toBeLessThan(BOARD_LOAD_BUDGET_MS);
  });
});

describe("compaction failure rolls back (TC-10, TC-11)", () => {
  const board = "store-compaction-failure";

  beforeEach(async () => {
    const fixture = retroBoard(12);
    const edits = seededEdits(fixture.doc, COMPACTION_UPDATE_COUNT - fixture.updates.length);
    await inBoard(board, (store) => {
      appendThroughDoc(store, [...fixture.updates, ...edits]);
      // Compact once, cleanly, so there is an old snapshot to compare against.
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      expect(store.compactIfNeeded(doc)).toBe(true);
    });
    // Grow the log again so the next compaction has work to do.
    await inBoard(board, (store) => {
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      for (const update of seededEdits(doc, COMPACTION_UPDATE_COUNT)) store.append(update, doc);
    });
  });

  it("when the log delete throws, the transaction rolls back and both survive", async () => {
    const before = await facts(board);
    expect(before.updateRows).toBeGreaterThan(0);
    expect(before.chunkRows).toBeGreaterThan(0);

    const outcome = await withInjectedFailure(
      board,
      "CREATE TRIGGER injected_failure BEFORE DELETE ON updates BEGIN SELECT RAISE(ABORT, 'injected log delete failure'); END",
      async () =>
        inBoard(board, (store) => {
          const doc = new Y.Doc();
          expect(store.load(doc).ok).toBe(true);
          const didCompact = store.compactIfNeeded(doc);
          return { didCompact, notes: stickySnapshot(doc) };
        }),
    );

    expect(outcome.didCompact).toBe(false);

    const after = await facts(board);
    expect(after.updateRows).toBe(before.updateRows);
    expect(after.updateBytes).toBe(before.updateBytes);
    expect(after.chunkRows).toBe(before.chunkRows);
    expect(after.chunkBytes).toBe(before.chunkBytes);
    expect(after.snapshotThroughSeq).toBe(before.snapshotThroughSeq);

    const reloaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(reloaded.result.ok).toBe(true);
    expect(reloaded.notes).toEqual(outcome.notes);
  });

  it("when the old snapshot cannot be cleared, nothing new is written", async () => {
    const before = await facts(board);

    const outcome = await withInjectedFailure(
      board,
      "CREATE TRIGGER injected_failure BEFORE DELETE ON snapshot_chunks BEGIN SELECT RAISE(ABORT, 'injected snapshot clear failure'); END",
      async () =>
        inBoard(board, (store) => {
          const doc = new Y.Doc();
          expect(store.load(doc).ok).toBe(true);
          const didCompact = store.compactIfNeeded(doc);
          return { didCompact, notes: stickySnapshot(doc) };
        }),
    );

    expect(outcome.didCompact).toBe(false);

    const after = await facts(board);
    expect(after.chunkRows).toBe(before.chunkRows);
    expect(after.chunkBytes).toBe(before.chunkBytes);
    expect(after.updateRows).toBe(before.updateRows);

    const reloaded = await inBoard(board, (store) => {
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: stickySnapshot(doc) };
    });
    expect(reloaded.result.ok).toBe(true);
    expect(reloaded.notes).toEqual(outcome.notes);
  });
});

describe("store bookkeeping", () => {
  it("state() reports what load read", async () => {
    const board = "store-bookkeeping";
    const fixture = retroBoard(4);
    const state = await inBoard(board, (store) => {
      appendThroughDoc(store, fixture.updates);
      const doc = new Y.Doc();
      store.load(doc);
      return store.state();
    });
    const reported: StoreState = state;
    expect(reported.logRows).toBe(fixture.updates.length);
    expect(reported.snapshotChunks).toBe(0);
    expect(reported.storageSchemaVersion).toBe(STORAGE_SCHEMA_VERSION);
  });
});
