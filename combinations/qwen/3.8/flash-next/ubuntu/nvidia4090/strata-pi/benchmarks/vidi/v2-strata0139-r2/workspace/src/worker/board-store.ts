/**
 * Board storage (`persist.board_store`).
 *
 * One SQLite database per board, inside that board's Durable Object:
 *
 *   storage_meta        key/value — `storage_schema_version`, `snapshot_through_seq`
 *   updates             the append-only update log (`seq`, `data`, `bytes`)
 *   snapshot_chunks     the compacted document, in rows under SNAPSHOT_CHUNK_BYTES
 *   quarantined_updates log rows that could not be read, kept out of the way
 *
 * A board is loaded as *snapshot + log*, and every change is appended to the log
 * before it is broadcast. When the log grows past a threshold the document is
 * re-encoded and the log is truncated, so loading a board never replays its
 * whole history.
 *
 * Everything here is synchronous, which is what the SQLite-backed Durable Object
 * storage API allows and what makes "stored before broadcast" (persist.seen_is_saved)
 * fall out for free: the row is inserted in the same turn in which the change was
 * applied, and the runtime holds outgoing messages until that write is durable.
 */

import * as Y from "yjs";
// The load origin (`board.model`): the room must neither store what it has just
// read back nor broadcast it.
import { LOAD_ORIGIN } from "../shared/board-model";
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_CREATED_AT_KEY,
  STORAGE_SCHEMA_VERSION,
} from "../shared/config";

/**
 * How many transactions a stored log row covers.
 *
 * A Yjs update is a *contiguous run* of one client's structs: it can only be
 * integrated by a document that already holds everything before the run. A log
 * of single-transaction rows therefore loses every later change from that client
 * if one row is unreadable — a hole, not a missing note.
 *
 * So each row is written as the update computed from the state vector
 * `LOG_LOOKBACK_ROWS - 1` rows earlier, which repeats the previous row's structs
 * inside it. A damaged row is then covered by the row after it: the log stays
 * contiguous and the rest of the board loads. `LOG_LOOKBACK_ROWS - 1` consecutive
 * damaged rows is the limit of that tolerance, and rows cost about
 * `LOG_LOOKBACK_ROWS` times as many bytes, which the compaction thresholds absorb.
 */
export const LOG_LOOKBACK_ROWS = 2;

/** A row read out of SQLite (`data` columns arrive as `ArrayBuffer`). */
export interface SqlRow {
  [column: string]: ArrayBuffer | string | number | null;
}

export interface SqlCursorLike {
  next(): { done?: boolean; value?: SqlRow } | undefined;
  toArray(): SqlRow[];
  one(): SqlRow;
  [Symbol.iterator](): Iterator<SqlRow>;
}

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

/**
 * The narrow view of Durable Object storage this store needs.
 *
 * `BoardRoom` passes `ctx.storage` straight in. It is declared structurally
 * rather than as `DurableObjectStorage` so the pure half of this file
 * (`chunkBytes`, `joinChunks`, `shouldCompact`) can be unit-tested from the
 * client type project — see NOTES.md.
 */
export interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(closure: () => T): T;
}

/** The outcome of loading a board's saved state into a document. */
export type LoadResult =
  /** Applied. `quarantined` log rows could not be read and were set aside. */
  | { ok: true; quarantined: number }
  /** Nothing trustworthy was applied: the room must not serve an empty board. */
  | { ok: false; reason: "snapshot-unreadable" | "sql-error"; error: string };

/**
 * Splits `data` into pieces of at most `size` bytes, so every snapshot row stays
 * well under the per-row size limit of SQLite-backed Durable Objects. An empty
 * input yields no chunks. Chunks are copies, never views onto `data`.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!(size > 0)) throw new RangeError("chunk size must be positive");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The inverse of `chunkBytes`. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Whether the update log has grown enough to be worth compacting. */
export function shouldCompact(
  count: number,
  bytes: number,
  updateCountLimit: number = COMPACTION_UPDATE_COUNT,
  byteLimit: number = COMPACTION_BYTES,
): boolean {
  return count >= updateCountLimit || bytes >= byteLimit;
}

/** The four tables, created once per board by `migrate`. */
export const STORAGE_SCHEMA_STATEMENTS: readonly string[] = [
  "CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)",
];

export const STORAGE_SCHEMA_VERSION_KEY = "storage_schema_version";
export const SNAPSHOT_THROUGH_SEQ_KEY = "snapshot_through_seq";

/** What the store believes about its own tables, for logs and tests. */
export interface StoreState {
  readonly storageSchemaVersion: number;
  readonly logRows: number;
  readonly logBytes: number;
  readonly snapshotChunks: number;
  readonly snapshotThroughSeq: number;
}

/**
 * The store itself.
 *
 * Errors are deliberately uneven, because the room reacts to them differently:
 * `append` rethrows (the room resets), `load` converts to a `LoadResult` (the
 * room refuses to serve), and `compactIfNeeded` swallows after a rollback (an
 * un-compacted board is still a correct board).
 */
export class BoardStore {
  private readonly storage: StorageLike;

  /** Log size, tracked in memory after `load` so a write never needs a COUNT(*). */
  private logRows = 0;
  private logBytes = 0;
  private snapshotChunks = 0;
  private snapshotThroughSeq = 0;
  private migrated = false;
  /** Encoded state vectors of the recent rows, newest last. */
  private stateVectors: Uint8Array[] = [];

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  /**
   * Does this board exist? (`share.not_found`, `share.legacy_boards`)
   *
   * A board exists when its storage says so:
   *
   *   - `storage_meta.created_at` is set (created through `POST /api/boards`), or
   *   - it has board content that predates this feature — at least one row in
   *     `updates` or `snapshot_chunks` — which is what keeps a board people were
   *     already using at an address working (share.legacy_boards).
   *
   * Read-only: the existence of `sqlite_master` is consulted before any table is
   * queried, so probing an unknown link neither creates tables nor writes a row
   * (TC-06, TC-09). A board is never created by *asking* about it.
   */
  existsReadOnly(): boolean {
    if (this.tableExists("storage_meta") && this.createdAt() !== null) return true;
    if (this.tableExists("updates") && this.hasRows("updates")) return true;
    if (this.tableExists("snapshot_chunks") && this.hasRows("snapshot_chunks")) return true;
    return false;
  }

  /** When this board was created, or `null` when it never was. */
  createdAt(): number | null {
    if (!this.tableExists("storage_meta")) return null;
    const value = this.getMeta(STORAGE_CREATED_AT_KEY);
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Stamps the board as created. Written once, by `BoardRoom.initialize()`. */
  setCreatedAt(createdAtMs: number): void {
    this.migrate();
    this.setMeta(STORAGE_CREATED_AT_KEY, String(createdAtMs));
  }

  /** Creates the tables and stamps the storage schema version. Writes no rows. */
  migrate(): void {
    if (this.migrated) return;

    this.storage.transactionSync(() => {
      for (const statement of STORAGE_SCHEMA_STATEMENTS) this.storage.sql.exec(statement);
    });

    if (this.getMeta(STORAGE_SCHEMA_VERSION_KEY) === undefined) {
      this.setMeta(STORAGE_SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    }
    this.migrated = true;
  }

  /**
   * Appends one row to the log.
   *
   * `update` is the change as it happened; `doc` is the document after it was
   * applied, which is what lets the row be written with a look-back (see
   * `LOG_LOOKBACK_ROWS`). Without `doc` the row is the raw update.
   *
   * SQL errors are rethrown: the room cannot keep serving a document it cannot
   * save, and it must not broadcast what it failed to write.
   */
  append(update: Uint8Array, doc?: Y.Doc): void {
    this.migrate();
    const row = doc === undefined ? update : this.lookBackUpdate(doc);

    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "INSERT INTO updates (data, bytes) VALUES (?, ?)",
        toArrayBuffer(row),
        row.byteLength,
      );
      this.logRows += 1;
      this.logBytes += row.byteLength;
    });

    if (doc !== undefined) this.rememberStateVector(doc);
  }

  /**
   * Reads snapshot + log into `doc`.
   *
   * - An unreadable snapshot is fatal for this load (`snapshot-unreadable`):
   *   most of the board is unreadable, and an empty board would be a lie.
   * - A log row Yjs cannot read is moved to `quarantined_updates` and the rest
   *   of the board still loads (`persist.partial_damage`).
   * - Any SQL failure is `sql-error`, never an empty-but-healthy result.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Reading a board does not create one (share.not_found): a board that has
      // never been initialised has no tables, and that is an empty board, not a
      // failure and not a reason to migrate. Tables are created by `initialize()`
      // and, for boards older than that, lazily by the first `append`.
      const hasSnapshotTable = this.tableExists("snapshot_chunks");
      const hasLogTable = this.tableExists("updates");

      const throughSeq = this.tableExists("storage_meta")
        ? Number(this.getMeta(SNAPSHOT_THROUGH_SEQ_KEY) ?? "0")
        : 0;
      const chunkRows = hasSnapshotTable
        ? this.storage.sql.exec("SELECT idx, data FROM snapshot_chunks ORDER BY idx").toArray()
        : [];

      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((row) => asBytes(row.data)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          // Nothing is deleted or quarantined: the saved board is left exactly
          // as it is so a retry (or a repair) can still succeed.
          logError("board-snapshot-unreadable", {
            chunks: chunkRows.length,
            bytes: snapshot.byteLength,
            error: errorMessage(error),
          });
          return { ok: false, reason: "snapshot-unreadable", error: errorMessage(error) };
        }
      }

      let quarantined = 0;
      let rows = 0;
      let bytes = 0;
      const logRows = hasLogTable
        ? this.storage.sql
            .exec("SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq", throughSeq)
            .toArray()
        : [];
      for (const row of logRows) {
        const seq = Number(row.seq);
        const update = asBytes(row.data);
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
          rows += 1;
          bytes += numberOr(row.bytes, update.byteLength);
        } catch (error) {
          this.quarantine(seq, row.data, errorMessage(error));
          quarantined += 1;
        }
      }

      this.snapshotChunks = chunkRows.length;
      this.snapshotThroughSeq = throughSeq;
      this.logRows = rows;
      this.logBytes = bytes;
      // The look-back window restarts from what was just loaded: the first row
      // written after a wake covers only itself, the next covers two, and so on.
      this.stateVectors = [Y.encodeStateVector(doc)];

      if (quarantined > 0) {
        logError("board-log-quarantined", { quarantined, applied: rows });
      }
      return { ok: true, quarantined };
    } catch (error) {
      logError("board-sql-error", { phase: "load", error: errorMessage(error) });
      return { ok: false, reason: "sql-error", error: errorMessage(error) };
    }
  }

  /**
   * Replaces snapshot + log with one snapshot when the log has outgrown its
   * thresholds, inside a single transaction so a failure can only ever leave
   * the board exactly as it was.
   *
   * @returns false for a no-op (below threshold) or a rolled-back failure.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logRows, this.logBytes)) return false;

    try {
      const maxSeq = Number(
        this.storage.sql.exec("SELECT COALESCE(MAX(seq), 0) AS seq FROM updates").one().seq,
      );
      // The in-memory document already contains snapshot + log, and Yjs
      // garbage-collects deleted content, so this tracks current board content
      // rather than the board's history.
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc), SNAPSHOT_CHUNK_BYTES);

      this.storage.transactionSync(() => {
        this.storage.sql.exec("DELETE FROM snapshot_chunks");
        chunks.forEach((chunk, index) => {
          this.storage.sql.exec(
            "INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)",
            index,
            toArrayBuffer(chunk),
          );
        });
        this.storage.sql.exec("DELETE FROM updates WHERE seq <= ?", maxSeq);
        this.setMeta(SNAPSHOT_THROUGH_SEQ_KEY, String(maxSeq));
      });

      this.snapshotChunks = chunks.length;
      this.snapshotThroughSeq = maxSeq;
      this.logRows = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      // `transactionSync` rolls the whole closure back: the previous snapshot
      // and every log row survive.
      logError("board-compaction-failed", { error: errorMessage(error) });
      return false;
    }
  }

  /** The store's own view of its tables (no query, these are its bookkeeping). */
  state(): StoreState {
    return {
      storageSchemaVersion: STORAGE_SCHEMA_VERSION,
      logRows: this.logRows,
      logBytes: this.logBytes,
      snapshotChunks: this.snapshotChunks,
      snapshotThroughSeq: this.snapshotThroughSeq,
    };
  }

  /** True once this store has tables of its own: after `migrate()` or a write. */
  get loaded(): boolean {
    return this.migrated;
  }

  // ---- internals ----------------------------------------------------------

  /** True when the table is in `sqlite_master`. Never creates anything. */
  private tableExists(name: string): boolean {
    const row = this.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)
      .next();
    return row !== undefined && row.done !== true && row.value !== undefined;
  }

  /** True when the table holds at least one row. Only called for tables that exist. */
  private hasRows(table: string): boolean {
    const row = this.storage.sql.exec(`SELECT 1 AS one FROM ${table} LIMIT 1`).next();
    return row !== undefined && row.done !== true && row.value !== undefined;
  }

  /** The state vector this new row should be computed against. */
  private lookBackUpdate(doc: Y.Doc): Uint8Array {
    // The retained window is the last `LOG_LOOKBACK_ROWS` state vectors, oldest
    // first, so the oldest one is the state `LOG_LOOKBACK_ROWS` rows back.
    const lookBack =
      this.stateVectors.length === 0
        ? null
        : this.stateVectors[Math.max(0, this.stateVectors.length - LOG_LOOKBACK_ROWS)];
    return lookBack === null || lookBack.byteLength === 0
      ? Y.encodeStateAsUpdate(doc)
      : Y.encodeStateAsUpdate(doc, lookBack);
  }

  /** Records the document's state vector, keeping the window bounded. */
  private rememberStateVector(doc: Y.Doc): void {
    this.stateVectors.push(Y.encodeStateVector(doc));
    if (this.stateVectors.length > LOG_LOOKBACK_ROWS) this.stateVectors.shift();
  }

  /** Moves one unreadable log row aside, in its own transaction. */
  private quarantine(
    seq: number,
    data: ArrayBuffer | string | number | null,
    errorText: string,
  ): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)",
        seq,
        asBytes(data),
        errorText.slice(0, 500),
        Date.now(),
      );
      this.storage.sql.exec("DELETE FROM updates WHERE seq = ?", seq);
    });
    logError("board-update-quarantined", { seq, error: errorText });
  }

  private getMeta(key: string): string | undefined {
    const cursor = this.storage.sql.exec("SELECT value FROM storage_meta WHERE key = ?", key);
    const row = cursor.next();
    if (row === undefined || row.done === true || row.value === undefined) return undefined;
    const value = row.value["value"];
    return value === null || value === undefined ? undefined : String(value);
  }

  private setMeta(key: string, value: string): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
    });
  }
}

/** Copies to a standalone `ArrayBuffer`, which is the binding SQLite accepts. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
}

function asBytes(value: ArrayBuffer | Uint8Array | string | number | null | undefined): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  // A NULL or non-blob column is not board content; an empty update applies nothing.
  return new Uint8Array(0);
}

function numberOr(value: ArrayBuffer | string | number | null, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structured logs: one JSON object per line, so failures are greppable. */
function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...fields }));
}
