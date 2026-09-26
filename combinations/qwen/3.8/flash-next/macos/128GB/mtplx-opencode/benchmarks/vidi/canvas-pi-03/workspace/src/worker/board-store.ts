// BoardStore (persist.board_store): the board's durable half.
//
// One SQLite database per Durable Object (per board). Two tables carry the
// document:
//
//   updates           append-only log of Yjs updates (the "delta" since the
//                     last compaction);
//   snapshot_chunks   the compacted document state, split into chunks so no
//                     row ever approaches the platform's per-row size limit.
//
// A load replays the snapshot and then every log row with a sequence number
// above `snapshot_through_seq` (the sequence the snapshot was taken at), which
// is what makes compaction a pure rewrite: rows at or below that sequence are
// already represented by the snapshot and can be deleted.
//
// Damage is handled in two different ways on purpose:
//
//   * a damaged LOG ROW is quarantined — moved out of `updates` into
//     `quarantined_updates` — and the rest of the board still loads (the board
//     loses one change, not everything);
//   * a damaged SNAPSHOT is fatal: most of the board is unreadable, so `load`
//     reports a failure and the room refuses to serve an empty document.
//
// Everything here is synchronous: the Durable Object SQL API is synchronous,
// and the room relies on "insert happened before broadcast" (see board-room).

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin used when replaying stored bytes into a document.
 * Anything applied with it is neither re-stored nor re-broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** The slice of DurableObjectStorage this module uses (the real object has
 * much more; naming only what is used keeps the module testable). */
export interface StorageLike {
  sql: {
    exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>>;
  };
  transactionSync<T>(closure: () => T): T;
}

export interface BoardStoreOptions {
  /** Test seam: throw instead of executing a statement whose SQL matches.
   * The failure is injected OUTSIDE SQLite, so real transaction semantics
   * still apply (the rollback in TC-11 is a real rollback). */
  failStatement?: (query: string) => boolean;
}

/** Split `data` into chunks of at most `size` bytes. Empty input yields no
 * chunks (a board with no content stores nothing). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.byteLength === 0) return [];
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    chunks.push(data.slice(offset, offset + chunkSize));
  }
  return chunks;
}

/** Concatenate chunks back into one byte string (exact inverse of chunkBytes). */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Compaction triggers on EITHER threshold (rows or bytes), at or above it. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Blob values come back from SQLite as ArrayBuffer. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  throw new Error(`unexpected blob value of type ${typeof value}`);
}

/** Bind values must be ArrayBuffer (not a Uint8Array view) for SQLite. */
function toBinding(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Structured error log (grep-able in `wrangler tail` / the DO trace). */
function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, level: 'error', ...fields }));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export class BoardStore {
  private readonly storage: StorageLike;
  private readonly failStatement?: (query: string) => boolean;

  /** Log rows / bytes currently in `updates`, tracked in memory so compaction
   * never needs a COUNT(*) on the hot path. */
  private logCount = 0;
  private logBytes = 0;

  /** Sequence number the stored snapshot was taken at. Rows at or below it
   * are already represented inside the snapshot. */
  private snapshotThroughSeq = 0;

  /** Highest sequence inserted here (monotonic; survives truncation). */
  private lastSeq = 0;

  constructor(storage: StorageLike, options: BoardStoreOptions = {}) {
    this.storage = storage;
    this.failStatement = options.failStatement;
  }

  /** Run `query` with bindings, honouring the injected-failure test seam. */
  private exec(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    if (this.failStatement !== undefined && this.failStatement(query)) {
      throw new Error(`injected SQL failure: ${query.trim()}`);
    }
    const cursor = this.storage.sql.exec(query, ...bindings);
    // Materialise: some rows are mutated or quarantined while being read, and
    // a lazily-iterating cursor would observe a changing table.
    return [...cursor];
  }

  /** Create the tables and stamp the storage schema version. Writes no
   * update rows: opening a board that was never edited must not create
   * document state (TC-25). */
  migrate(): void {
    this.exec(`CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.exec(
      `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
    );
    this.exec(`CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`);
    this.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
    );
    const stamped = [...this.exec(`SELECT value FROM storage_meta WHERE key = ?`, 'storage_schema_version')];
    if (stamped.length === 0) {
      this.exec(
        `INSERT INTO storage_meta (key, value) VALUES (?, ?)`,
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /** Append one update to the log. SQL errors are RE-THROWN: the caller
   * (BoardRoom) treats a failed write as a storage failure. */
  append(update: Uint8Array): void {
    const bytes = update.byteLength;
    const blob = toBinding(update);
    // The insert and the bookkeeping share one transaction, so a failure can
    // never leave a log row without its counter (or the reverse).
    this.storage.transactionSync(() => {
      this.exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, blob, bytes);
      const rows = this.exec(`SELECT seq FROM updates ORDER BY seq DESC LIMIT 1`);
      const seq = Number(rows[0]?.['seq'] ?? this.lastSeq + 1);
      this.lastSeq = Math.max(this.lastSeq, seq);
      this.logCount += 1;
      this.logBytes += bytes;
    });
  }

  /** Replay the stored snapshot + log into `doc`. */
  /** Replay the stored snapshot + log into `doc`.
   *
   * The replay happens inside a SCRATCH document first and is copied into
   * `doc` at the end. That is what makes TC-09 work: a damaged update does not
   * merely throw, it leaves whatever document it touched in a half-decoded
   * state, so applying rows straight into `doc` would lose every note that was
   * stored after the damage. Building into a scratch document lets the damaged
   * row be dropped and replayed around, so the rest of the board survives. */
  load(doc: Y.Doc): LoadResult {
    try {
      this.snapshotThroughSeq = this.readSnapshotThroughSeq();
      this.logCount = 0;
      this.logBytes = 0;

      // --- snapshot ---------------------------------------------------------
      const chunks = this.exec(`SELECT data FROM snapshot_chunks ORDER BY idx`).map((row) =>
        toBytes(row['data']),
      );
      const snapshotBytes = chunks.length > 0 ? joinChunks(chunks) : null;
      let scratchDoc = new Y.Doc({ gc: true });
      let scratch = scratchDoc;
      if (snapshotBytes !== null) {
        try {
          Y.applyUpdate(scratchDoc, snapshotBytes, LOAD_ORIGIN);
        } catch (error) {
          // Nothing is deleted here: an unreadable snapshot is a board-level
          // failure, and silently dropping the snapshot would show an empty
          // board — the exact thing PRD persist.load_failure forbids.
          return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(error) };
        }
      }

      /** Rebuild the scratch document from the rows that DID apply (used after
       * a damaged row poisoned it). */
      const rebuild = (good: Uint8Array[]) => {
        const fresh = new Y.Doc({ gc: true });
        if (snapshotBytes !== null) Y.applyUpdate(fresh, snapshotBytes, LOAD_ORIGIN);
        for (const update of good) Y.applyUpdate(fresh, update, LOAD_ORIGIN);
        return fresh;
      };

      // --- log --------------------------------------------------------------
      let quarantined = 0;
      const applied: Uint8Array[] = [];
      const rows = this.exec(
        `SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq`,
        this.snapshotThroughSeq,
      );
      for (const row of rows) {
        const seq = Number(row['seq']);
        const bytes = toBytes(row['data']);
        try {
          Y.applyUpdate(scratch, bytes, LOAD_ORIGIN);
          applied.push(bytes);
          this.logCount += 1;
          this.logBytes += bytes.byteLength;
        } catch (error) {
          const message = errorMessage(error);
          // One damaged change must not lose the board: move the row aside
          // (atomically, so it can never be applied twice) and replay the rest
          // around it.
          this.storage.transactionSync(() => {
            this.exec(`DELETE FROM updates WHERE seq = ?`, seq);
            this.exec(
              `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
              seq,
              bytes.slice(),
              message,
              Date.now(),
            );
          });
          quarantined += 1;
          logError('board.quarantine', { seq, bytes: bytes.byteLength, error: message });
          scratchDoc.destroy();
          scratchDoc = rebuild(applied.slice());
          scratch = scratchDoc;
        }
      }

      // Copy the verified state into the caller's document. `doc` is empty
      // here (the room always builds a fresh document per wake), so this is
      // one atomic state import.
      const source = applied.length === 0 && snapshotBytes === null ? null : scratchDoc;
      if (source !== null) {
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), LOAD_ORIGIN);
      }
      source?.destroy();

      this.lastSeq = Math.max(this.lastSeq, this.readMaxSeq());
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: errorMessage(error) };
    }
  }

  /** Replace the update log with a snapshot once a threshold is reached.
   * Never throws: a failure rolls the whole rewrite back (snapshot and log
   * stay exactly as they were) and is reported through the return value and
   * the error log. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /** The compaction rewrite: snapshot replaces the log inside ONE transaction.
   * Returns false (with everything left alone) if any statement fails. */
  private compact(doc: Y.Doc): boolean {
    if (this.lastSeq === 0) return false;
    const throughSeq = this.lastSeq;
    let encoded: Uint8Array;
    try {
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      logError('board.compact.encode', { error: errorMessage(error) });
      return false;
    }
    const chunks = chunkBytes(encoded);
    try {
      this.storage.transactionSync(() => {
        this.exec(`DELETE FROM snapshot_chunks`);
        chunks.forEach((chunk, idx) => {
          this.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`, idx, toBinding(chunk));
        });
        this.exec(`DELETE FROM updates WHERE seq <= ?`, throughSeq);
        this.exec(
          `INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          'snapshot_through_seq',
          String(throughSeq),
        );
      });
    } catch (error) {
      logError('board.compact', { error: errorMessage(error), throughSeq });
      return false; // rolled back: previous snapshot and full log are intact
    }
    this.logCount = 0;
    this.logBytes = 0;
    this.snapshotThroughSeq = throughSeq;
    return true;
  }

  /** Test seam: run the compaction rewrite regardless of the thresholds, so a
   * fixture can build a Snapshotted board without writing 500 rows. Same code
   * path as the real trigger (including the rollback on failure). */
  forceCompact(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  /** In-memory bookkeeping (used by tests and by the room's diagnostics). */
  get stats(): { logCount: number; logBytes: number; snapshotThroughSeq: number } {
    return {
      logCount: this.logCount,
      logBytes: this.logBytes,
      snapshotThroughSeq: this.snapshotThroughSeq,
    };
  }

  private readSnapshotThroughSeq(): number {
    const rows = this.exec(`SELECT value FROM storage_meta WHERE key = ?`, 'snapshot_through_seq');
    const value = Number(rows[0]?.['value'] ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private readMaxSeq(): number {
    const rows = this.exec(`SELECT MAX(seq) AS maxSeq FROM updates`);
    const value = Number(rows[0]?.['maxSeq'] ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  // --- test-only storage accessors -----------------------------------------
  // Used by the TEST_HOOKS routes (src/worker/test-hooks.ts); never called
  // from a production path.

  /** Raw rows of the update log (sequence + declared byte count). */
  dumpLog(): { seq: number; bytes: number }[] {
    return this.exec(`SELECT seq, bytes FROM updates ORDER BY seq`).map((row) => ({
      seq: Number(row['seq']),
      bytes: Number(row['bytes']),
    }));
  }

  /** Raw snapshot chunks, in order. */
  dumpSnapshot(): { idx: number; bytes: number }[] {
    return this.exec(`SELECT idx, length(data) AS size FROM snapshot_chunks ORDER BY idx`).map(
      (row) => ({ idx: Number(row['idx']), bytes: Number(row['size']) }),
    );
  }

  /** Raw quarantined rows (sequence + the error that moved them there). */
  dumpQuarantined(): { seq: number; error: string }[] {
    return [...this.exec(`SELECT seq, error FROM quarantined_updates ORDER BY seq`)].map((row) => ({
      seq: Number(row['seq']),
      error: String(row['error']),
    }));
  }

  /** Raw bytes of one snapshot chunk (test fixtures only). */
  readSnapshotChunk(idx: number): Uint8Array | null {
    const rows = this.exec(`SELECT data FROM snapshot_chunks WHERE idx = ?`, idx);
    return rows.length === 0 ? null : toBytes(rows[0]['data']);
  }

  /** Overwrite one snapshot chunk with `bytes` (the damaged-snapshot fixture). */
  overwriteSnapshotChunk(idx: number, bytes: Uint8Array): void {
    this.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, toBinding(bytes), idx);
  }
}
