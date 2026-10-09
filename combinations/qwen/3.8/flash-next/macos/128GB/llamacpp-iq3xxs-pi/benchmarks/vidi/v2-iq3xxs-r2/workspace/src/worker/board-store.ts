import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * One board's SQLite storage inside its Durable Object (design: "Board storage").
 *
 * The log of `updates` rows is the truth; `snapshot_chunks` is a bounded window over
 * it (compaction replaces the prefix of the log it covers); `quarantined_updates`
 * holds the rare row that Yjs refuses to apply again, so one damaged change costs one
 * change and not the board (`persist.partial_damage`).
 *
 * All statements are synchronous (`sql.exec`, `transactionSync`), which is what lets
 * the room write a row in the same turn it applied the update and broadcast only after
 * the insert (design decision 1).
 */

/** The result of loading a board; `ok:false` never means "empty" (`persist.load_failure`). */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Transaction origin of bytes coming from storage: they are already stored. */
export const LOAD_ORIGIN = 'vidi6-load';

/** `storage_meta` keys this store owns. */
export const META_SCHEMA_VERSION = 'storage_schema_version';
export const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';
/**
 * Story 5 (`share.not_found`): when this board was created by `POST /api/boards`, in
 * epoch milliseconds. Its absence does not mean the board does not exist — a board
 * that already had content before links existed never got one (`share.legacy_boards`).
 */
export const META_CREATED_AT = 'created_at';

/** Every table this store owns, in the order `migrate` creates them. */
const TABLE_NAMES = ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates'] as const;

/**
 * Split `data` into chunks of at most `size` bytes (0 bytes in, 0 chunks out), so
 * every row stays well under the platform's per-row size limit.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new RangeError(`chunk size must be positive, got ${size}`);
  const chunks: Uint8Array[] = [];
  // `slice` (not `subarray`) so every chunk owns its bytes: SQL bindings and
  // cross-chunk concatenation must not depend on the original buffer's lifetime.
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** The exact inverse of `chunkBytes`, in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when the log has grown enough that compaction is worth its cost. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** What a BLOB column comes back as (typed as the engine types it, normalised below). */
type BlobValue = ArrayBuffer | string | number | null;

function toBytes(value: BlobValue): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`expected BLOB bytes, got ${value === null ? 'null' : typeof value}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Row shapes as `type` aliases, not interfaces: only aliases get the implicit index
// signature `sql.exec<T>` asks for.
export type MetaRow = { value: string };
export type UpdateRow = { seq: number; data: BlobValue; bytes: number };
export type SeqRow = { seq: number; bytes: number };
export type ChunkRow = { data: BlobValue };
export type CountRow = { total: number };

export class BoardStore {
  /**
   * Rows and bytes of the log still on disk, kept in memory after `load` so the
   * threshold check costs nothing per write. Reset by `load` and `compactIfNeeded`.
   */
  private logRows = 0;
  private logBytes = 0;
  /** Highest `updates.seq` this instance has seen (0 when the log is empty). */
  private lastSeq = 0;
  /** `updates.seq` values at or below this are covered by the snapshot. */
  private snapshotThroughSeq = 0;

  /**
   * True when the last `load` left yjs holding rows back (`store.pendingStructs`):
   * yjs integrates a client's updates only against that client's own clock, so
   * quarantining one row pauses that author's *later* rows indefinitely (everyone
   * else's apply normally). Compaction would delete those still-invaluable log rows,
   * so it stays off until a load comes back gap-free.
   */
  private logHasPending = false;

  /**
   * Story 5: whether *this instance* knows the tables are there — set by `migrate`, or
   * by a `load` that found them. False for a board nothing has ever written, and that
   * is the point: `load` and `existsReadOnly` answer without creating anything, and the
   * first `append` migrates. Probing an unknown link therefore leaves no storage.
   */
  private tablesReady = false;

  /**
   * Test-only failure injection (`tests/integration`), called with each statement
   * before it runs; a throw makes that statement fail exactly as a disk error would,
   * inside the same `transactionSync`, so real rollback applies. Production code never
   * sets it; it exists because a real disk failure cannot be produced on demand.
   */
  testBeforeExec?: (query: string) => void;

  constructor(readonly storage: DurableObjectStorage) {}

  /** Every statement goes through here, so the test seam cannot be bypassed. */
  private exec<T extends Record<string, SqlStorageValue> = Record<string, never>>(
    query: string,
    ...bindings: unknown[]
  ) {
    this.testBeforeExec?.(query);
    // BLOB bindings are `Uint8Array` at runtime; the published types only list
    // `ArrayBuffer`, hence the cast on the spread.
    return this.storage.sql.exec<T>(query, ...(bindings as SqlStorageValue[]));
  }

  /**
   * The names of this board's tables that exist in storage right now. Reads
   * `sqlite_master` only, so it is safe to ask about a board that was never created.
   */
  private tableNamesPresent(): Set<string> {
    const placeholders = TABLE_NAMES.map(() => '?').join(', ');
    const rows = this.exec<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      ...TABLE_NAMES,
    ).toArray();
    return new Set(rows.map((row) => row.name));
  }

  /** True when any of this board's tables exist: a board never written has none. */
  hasTables(): boolean {
    return this.tableNamesPresent().size > 0;
  }

  /**
   * Story 5's existence rule (`share.not_found`, `share.legacy_boards`): a board exists
   * once it was created (`created_at`), or once it has anything at all to show — a log
   * row or a snapshot chunk, which is how a board that predates links still opens.
   *
   * It only reads: an unknown id has no tables, and asking about it creates none, so a
   * person poking at a mistyped link leaves no storage behind (TC-06, TC-09).
   */
  existsReadOnly(): boolean {
    const present = this.tableNamesPresent();
    if (present.size === 0) return false;
    if (present.has('storage_meta')) {
      const created = this.exec<MetaRow>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_CREATED_AT,
      ).next();
      if (created.done === false) return true;
    }
    // A board with content but no `created_at` is a legacy one; either table counts.
    for (const table of ['updates', 'snapshot_chunks']) {
      if (!present.has(table)) continue;
      const row = this.exec<{ seq: number }>(`SELECT 1 AS seq FROM ${table} LIMIT 1`).next();
      if (row.done === false) return true;
    }
    return false;
  }

  /** When this board was created by `POST /api/boards`, or null when it never was. */
  createdAt(): number | null {
    const row = this.exec<MetaRow>(
      'SELECT value FROM storage_meta WHERE key = ?',
      META_CREATED_AT,
    ).next();
    return row.done === true ? null : Number.parseInt(row.value.value, 10);
  }

  /**
   * Record the moment this board was created, if it has not been recorded: the second
   * call changes nothing and answers false (TC-15, `initialize()` returns `exists`).
   */
  markCreatedAtIfAbsent(at: number): boolean {
    if (this.createdAt() !== null) return false;
    this.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
      META_CREATED_AT,
      String(at),
    );
    return true;
  }

  /**
   * Create the tables and the `storage_schema_version` row if absent. Writes no update
   * rows, so a board that was only ever opened stays honestly empty (TC-25).
   *
   * Story 5: nothing calls this on their own initiative any more — `initialize()` (a
   * board being created) and the first `append()` (a legacy board's first new change)
   * do, so a board nobody has created still has no tables to probe (TC-06).
   */
  migrate(): void {
    this.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    const version = this.exec<MetaRow>(
      'SELECT value FROM storage_meta WHERE key = ?',
      META_SCHEMA_VERSION,
    ).next();
    if (version.done === false && Number.parseInt(version.value.value, 10) !== STORAGE_SCHEMA_VERSION) {
      // A real version mismatch would need a migration; there is none yet, and
      // pretending to serve a foreign database would be the dishonest option.
      throw new Error(
        `storage schema version ${version.value.value} is not supported (${STORAGE_SCHEMA_VERSION} expected)`,
      );
    }
    if (version.done === true) {
      this.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
    // Keep the in-memory log picture consistent with an untouched database.
    this.readLogTally();
    this.tablesReady = true;
  }

  /**
   * Add one Yjs update to the log (called for every applied update, design decision 1).
   * SQL errors rethrow: the caller drops the room rather than serve a doc that drifts
   * away from storage (`persist.save_failure`).
   */
  append(update: Uint8Array): void {
    // Story 5: `load` no longer creates the tables, so the first change to a board
    // (including one a test hook seeds) brings them with it.
    if (!this.tablesReady) this.migrate();
    const inserted = this.exec<{ seq: number }>(
      'INSERT INTO updates (data, bytes) VALUES (?, ?) RETURNING seq',
      update.slice(),
      update.length,
    ).next();
    // AUTOINCREMENT only grows, so the newest row carries the highest seq; the
    // RETURNING value keeps that true even if the engine ever hands out a gap.
    if (inserted.done === false && inserted.value.seq > this.lastSeq) {
      this.lastSeq = inserted.value.seq;
    }
    this.logRows += 1;
    this.logBytes += update.length;
  }

  /**
   * Fill `doc` with the snapshot and every log row after it. A log row Yjs refuses is
   * moved to `quarantined_updates` and the rest of the board still loads
   * (`persist.partial_damage`, TC-09); anything else that goes wrong answers
   * `ok:false`, never a silently empty doc (`persist.load_failure`).
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Story 5: a board nobody has ever written has no tables, and loading it must not
      // make any. It is an empty board — empty, not broken, and not storage.
      if (!this.hasTables()) {
        this.tablesReady = false;
        this.logRows = 0;
        this.logBytes = 0;
        this.lastSeq = 0;
        this.snapshotThroughSeq = 0;
        this.logHasPending = false;
        return { ok: true, quarantined: 0 };
      }
      this.tablesReady = true;
      // 1. The snapshot, if one exists. Refusing to apply it is fatal: most of the
      //    board would be missing (design decision 5).
      const through = this.readSnapshot(doc);
      if (through === null) {
        const error = 'snapshot chunks failed to apply';
        return { ok: false, reason: 'snapshot-unreadable', error };
      }

      // 2. The log after the snapshot, oldest first (TC-07).
      let quarantined = 0;
      let rows = 0;
      let bytes = 0;
      let maxSeq = through;
      // Materialise the log before applying: quarantining deletes rows, and a SQLite
      // cursor must not be walked while its own table is being changed.
      const logRows = this.exec<UpdateRow>(
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
        maxSeq,
      ).toArray();
      // Damaged bytes throw *midway through* a Yjs transaction and poison the
      // document: everything applied afterwards is silently lost. So every row is
      // first applied to a throwaway probe document, and the real `doc` only ever
      // sees bytes that survived. A throw poisons the probe, so it gets a fresh one.
      let probe = new Y.Doc();
      for (const row of logRows) {
        rows += 1;
        bytes += row.bytes;
        if (row.seq > maxSeq) maxSeq = row.seq;
        try {
          Y.applyUpdate(probe, toBytes(row.data));
        } catch (error) {
          const reason = messageOf(error);
          this.quarantine(row.seq, toBytes(row.data), reason);
          quarantined += 1;
          rows -= 1;
          bytes -= row.bytes;
          probe = new Y.Doc();
          continue;
        }
        Y.applyUpdate(doc, toBytes(row.data), LOAD_ORIGIN);
      }
      this.logRows = rows;
      this.logBytes = bytes;
      this.lastSeq = maxSeq;
      this.snapshotThroughSeq = through;
      // yjs parks structs whose predecessors are missing in `store.pendingStructs`.
      // They stay on disk, inert; compaction must not sweep them away (see
      // `logHasPending`).
      this.logHasPending =
        (doc.store as unknown as { pendingStructs?: { update: Uint8Array } | null })
          .pendingStructs != null;
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: messageOf(error) };
    }
  }

  /**
   * Replace the snapshot with `doc`'s whole current state and drop the log rows it
   * covers, in one transaction: if any statement fails the old snapshot and log are
   * still there untouched (TC-11). Never throws: a failed compaction costs nothing but
   * the attempt.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logRows, this.logBytes)) return false;
    if (this.logHasPending) {
      // A quarantined row may have paused its author's later rows; the log is the
      // only copy of those, so it cannot be truncated yet.
      return false;
    }
    try {
      // The in-memory doc already holds snapshot + log, so its encoded state is the
      // whole board; Yjs garbage-collects deleted content, so this tracks current
      // content, not history (design: large boards open within budget).
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxSeq = this.lastSeq;
      this.storage.transactionSync(() => {
        this.exec('DELETE FROM snapshot_chunks');
        for (let idx = 0; idx < chunks.length; idx += 1) {
          this.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunks[idx]);
        }
        this.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          META_SNAPSHOT_THROUGH_SEQ,
          String(maxSeq),
        );
      });
      this.logRows = 0;
      this.logBytes = 0;
      this.snapshotThroughSeq = maxSeq;
      return true;
    } catch (error) {
      // `transactionSync` has rolled everything back at this point.
      console.error(
        JSON.stringify({ event: 'compaction_failed', error: messageOf(error) }),
      );
      return false;
    }
  }

  /** Counts and bytes of the log as it stands; keeps the in-memory tally honest. */
  private readLogTally(): void {
    let rows = 0;
    let bytes = 0;
    let maxSeq = 0;
    for (const row of this.exec<SeqRow>('SELECT seq, bytes FROM updates ORDER BY seq')) {
      rows += 1;
      bytes += row.bytes;
      if (row.seq > maxSeq) maxSeq = row.seq;
    }
    this.logRows = rows;
    this.logBytes = bytes;
    this.lastSeq = maxSeq;
    this.snapshotThroughSeq = this.readThroughSeq();
  }

  private readThroughSeq(): number {
    const row = this.exec<MetaRow>(
      'SELECT value FROM storage_meta WHERE key = ?',
      META_SNAPSHOT_THROUGH_SEQ,
    ).next();
    return row.done === false ? Number.parseInt(row.value.value, 10) || 0 : 0;
  }

  /**
   * Apply the snapshot chunks, when there are any. Returns the seq the snapshot
   * covers, or null when the bytes refuse to apply (nothing is deleted or quarantined
   * in that case — TC-10).
   */
  private readSnapshot(doc: Y.Doc): number | null {
    const through = this.readThroughSeq();
    const chunks: Uint8Array[] = [];
    for (const row of this.exec<ChunkRow>('SELECT data FROM snapshot_chunks ORDER BY idx')) {
      chunks.push(toBytes(row.data));
    }
    this.snapshotThroughSeq = through;
    if (chunks.length === 0) return through;
    try {
      Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'snapshot_unreadable', error: messageOf(error) }),
      );
      return null;
    }
    return through;
  }

  /** Move one damaged row out of the log, atomically (TC-09). */
  private quarantine(seq: number, data: Uint8Array, reason: string): void {
    const at = Date.now();
    this.storage.transactionSync(() => {
      this.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data.slice(),
        reason,
        at,
      );
    });
    console.error(JSON.stringify({ event: 'quarantined_update', seq, error: reason }));
  }
}
