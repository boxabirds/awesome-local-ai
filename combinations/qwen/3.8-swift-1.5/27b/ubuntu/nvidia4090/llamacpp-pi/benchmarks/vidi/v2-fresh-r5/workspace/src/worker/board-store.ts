/**
 * BoardStore: SQLite-backed persistence for one board (Durable Object
 * storage).
 *
 * Schema (one database per board):
 *   storage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *     -- keys: storage_schema_version, snapshot_through_seq
 *   updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL,
 *           bytes INTEGER NOT NULL)
 *   snapshot_chunks(idx INTEGER PRIMARY KEY, data BLOB NOT NULL)
 *   quarantined_updates(seq INTEGER PRIMARY KEY, data BLOB NOT NULL,
 *                       error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)
 *
 * Every accepted update is appended as it happens (persist.automatic); the
 * log is compacted into a chunked snapshot once it grows past the
 * thresholds so wake-time replay stays bounded. A damaged log row is
 * quarantined on load so one bad change cannot lose the board
 * (persist.partial_damage); an unreadable snapshot or a SQL error makes the
 * load fail honestly (persist.load_failure).
 *
 * SQL access uses the Durable Object storage API:
 * `storage.sql.exec(query, ...bindings)` (result cursor via `toArray()`),
 * with `storage.transactionSync` for atomic multi-statement work. BLOBs are
 * passed as `Uint8Array` bindings and come back as `ArrayBuffer`.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin for updates applied while loading the saved state. */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

/** Result of loading a board's saved state into a doc. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** The result cursor of an executed SQL statement. */
export interface BoardSqlCursor {
  /** All result rows as plain objects (empty array when no rows). */
  toArray(): unknown[];
}

/**
 * The Durable Object storage surface BoardStore uses. Declared
 * structurally so this module typechecks in both the worker world and the
 * plain unit-test world; a real `DurableObjectStorage` satisfies it.
 */
export interface BoardStorage {
  sql: {
    /** Execute one SQL statement (or a script) with optional bindings. */
    exec(query: string, ...bindings: unknown[]): BoardSqlCursor;
  };
  transactionSync(fn: () => void): void;
}

/**
 * Split `data` into chunks of at most `size` bytes (SNAPSHOT_CHUNK_BYTES by
 * default). An empty input yields zero chunks.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** Reassemble chunks produced by `chunkBytes` into one byte-identical array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * True when the update log should be compacted: at least
 * COMPACTION_UPDATE_COUNT rows, or at least COMPACTION_BYTES total.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * Test seam (integration tests only): wraps the storage a room's BoardStore
 * sees, so tests can inject SQL failures outside the real SQLite layer
 * (real transaction semantics still apply).
 */
let storageWrapper: ((storage: BoardStorage) => BoardStorage) | null = null;

export function setStorageWrapper(
  wrapper: ((storage: BoardStorage) => BoardStorage) | null,
): void {
  storageWrapper = wrapper;
}

/** Convert a BLOB column (ArrayBuffer) to a Uint8Array. */
function asBytes(value: unknown): Uint8Array {
  return new Uint8Array(value as ArrayBuffer);
}

/**
 * One board's durable state. All SQL is synchronous (Durable Object
 * SQLite); `append` rethrows SQL failures (the room resets itself), `load`
 * converts failures to a LoadResult and quarantines damaged log rows, and
 * `compactIfNeeded` never throws (failures roll back and return false).
 */
export class BoardStore {
  private readonly storage: BoardStorage;
  /** In-memory log stats, maintained to avoid COUNT(*) per write. */
  private rowCount = 0;
  private byteTotal = 0;
  /** True once the schema is known to exist (story 5 lazy migrate). */
  private schemaReady = false;

  constructor(storage: BoardStorage) {
    // Test seam: a registered wrapper (integration tests only) can replace
    // the storage a store sees, e.g. to inject SQL failures. Production
    // never registers a wrapper, so this is a no-op there.
    this.storage = storageWrapper ? storageWrapper(storage) : storage;
  }

  /** Create the tables and set storage_schema_version if absent. Writes no update rows. */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `);
    const row = (
      sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version').toArray()
    )[0] as { value: string } | undefined;
    if (!row) {
      sql
        .exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', 'storage_schema_version', String(STORAGE_SCHEMA_VERSION))
        .toArray();
    }
  }

  /** Append one update to the log. Throws on SQL failure. */
  append(update: Uint8Array): void {
    this.ensureSchema();
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length).toArray();
    this.rowCount += 1;
    this.byteTotal += update.length;
  }

  /**
   * Read-only existence check (story 5, share.board_api): true when the
   * board has `storage_meta.created_at`, or (legacy, share.legacy_boards)
   * at least one row in `updates` or `snapshot_chunks`. Queries
   * `sqlite_master` first and NEVER creates tables, so probing an unknown
   * link leaves no storage behind.
   */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    const tables = new Set(
      (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray() as { name: string }[])
        .map((r) => r.name),
    );
    if (tables.has('storage_meta')) {
      const row = (sql
        .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
        .toArray()[0]) as { value: string } | undefined;
      if (row) return true;
    }
    for (const table of ['updates', 'snapshot_chunks']) {
      if (tables.has(table)) {
        const row = sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).toArray()[0] as { c: number };
        if (row.c > 0) return true;
      }
    }
    return false;
  }

  /**
   * Create the schema if it does not exist yet. Story 5: `migrate()` no
   * longer runs on construct — it runs inside `initialize()` and lazily
   * before the first `append()`/`compact()` (legacy boards already have
   * tables).
   */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    const row = (
      this.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'updates'")
        .toArray()[0]
    ) as { name: string } | undefined;
    if (row) {
      this.schemaReady = true;
      return;
    }
    this.migrate();
    this.schemaReady = true;
  }

  /**
   * Load the saved state into `doc`: snapshot chunks first, then log rows
   * with seq > snapshot_through_seq. Damaged log rows are moved to
   * quarantined_updates and counted; an unreadable snapshot or a SQL error
   * yields `ok: false` with nothing deleted or quarantined.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const sql = this.storage.sql;

      // 0. A board with no tables is an empty board (story 5): return without
      // creating anything — probing an unknown link must write nothing.
      const tables = new Set(
        (sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray() as { name: string }[])
          .map((r) => r.name),
      );
      if (
        !tables.has('storage_meta') &&
        !tables.has('updates') &&
        !tables.has('snapshot_chunks')
      ) {
        return { ok: true, quarantined: 0 };
      }

      // 1. The chunked snapshot (if any).
      const chunkRows = sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray() as Array<{ data: ArrayBuffer }>;
      if (chunkRows.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunkRows.map((r) => asBytes(r.data))), LOAD_ORIGIN);
        } catch (err) {
          // A damaged snapshot means most of the board is unreadable: fail
          // honestly, delete nothing.
          return { ok: false, reason: 'snapshot-unreadable', error: String(err) };
        }
      }

      const metaRow = (
        sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq').toArray()
      )[0] as { value: string } | undefined;
      const throughSeq = metaRow ? Number(metaRow.value) : 0;

      // 2. Log rows recorded after the snapshot.
      const rows = sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq)
        .toArray() as Array<{ seq: number; data: ArrayBuffer }>;
      let quarantined = 0;
      let appliedCount = 0;
      let appliedBytes = 0;
      for (const row of rows) {
        const data = asBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (err) {
          this.quarantine(row.seq, data, err);
          quarantined += 1;
          continue;
        }
        appliedCount += 1;
        appliedBytes += data.length;
      }

      this.rowCount = appliedCount;
      this.byteTotal = appliedBytes;
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  /**
   * Compact the log into a new chunked snapshot when the thresholds are
   * reached. Never throws: a failed transaction rolls back and returns
   * false. Returns true when a compaction happened.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;
    return this.compact(doc);
  }

  /**
   * Unconditional compaction (used by `compactIfNeeded` and the test-only
   * hooks). The in-memory doc already contains snapshot + log, so
   * `encodeStateAsUpdate` captures the whole board.
   */
  compact(doc: Y.Doc): boolean {
    try {
      const sql = this.storage.sql;
      this.ensureSchema();
      const maxSeq = (
        sql.exec('SELECT MAX(seq) AS m FROM updates').toArray()[0] as { m: number | null }
      ).m ?? 0;
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      // Atomic: a failure rolls back and leaves the previous snapshot and
      // the full log intact (persist.compaction). This runs in a macrotask
      // (the room's flush), NOT inside a WebSocket-message activation —
      // workerd leaves the shared SQLite lock held when a transactionSync
      // runs in that activation, so the room defers all writes off it.
      this.storage.transactionSync(() => {
        sql.exec('DELETE FROM snapshot_chunks').toArray();
        for (let i = 0; i < chunks.length; i++) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]).toArray();
        }
        sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq).toArray();
        sql
          .exec(
            'INSERT INTO storage_meta (key, value) VALUES (?, ?) ' +
              'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            'snapshot_through_seq',
            String(maxSeq),
          )
          .toArray();
      });
      this.rowCount = 0;
      this.byteTotal = 0;
      return true;
    } catch (err) {
      console.error('BOARD_STORE compaction failed, transaction rolled back', {
        error: String(err),
      });
      return false;
    }
  }

  /** Move one damaged log row to quarantined_updates (atomic). */
  private quarantine(seq: number, data: Uint8Array, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error('BOARD_STORE quarantined damaged update', { seq, error: message });
    this.storage.transactionSync(() => {
      this.storage.sql
        .exec(
          'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data,
          message,
          Date.now(),
        )
        .toArray();
      this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq).toArray();
    });
  }
}
