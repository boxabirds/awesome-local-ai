import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '@shared/config';

/**
 * Origin tag used when applying updates to the in-memory doc while loading from
 * storage. The board room never stores or broadcasts updates whose origin is
 * this value, so a reload does not echo back into the log or to other clients.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Split `data` into chunks of at most `size` bytes. Zero bytes -> zero chunks. */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** Concatenate chunks back into a single byte array (inverse of chunkBytes). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Whether the update log should be compacted given its row count and byte total. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// Copy a Uint8Array (which may be a view into a larger buffer) into a standalone
// ArrayBuffer, which is the binding type SQLite stores as a BLOB.
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u.length);
  copy.set(u);
  return copy.buffer;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * SQLite-backed, per-board update log with chunked snapshot compaction.
 *
 * The SQL API of SQLite-backed Durable Objects is synchronous; every method here
 * runs in a single turn. `append` rethrows SQL errors so the caller can reset the
 * room; `load` converts snapshot/SQL errors into an `ok:false` result; damaged log
 * rows are quarantined and counted so the rest of the board still loads; and
 * `compactIfNeeded` never throws (it rolls back and returns false on failure).
 */
export class BoardStore {
  private readonly sql: SqlStorage;
  private readonly storage: DurableObjectStorage;

  // Tracked in memory after load to avoid a COUNT(*)/SUM on every append.
  private logCount = 0;
  private logBytes = 0;

  // Whether the SQL tables are known to exist for this board. Set by migrate()
  // and by a load() that finds them. Unknown boards never create tables (probing
  // a link must leave no storage behind), so append() migrates lazily on first use.
  private tablesReady = false;

  /** Test-only hook: throw at a specific point inside a compaction transaction. */
  __failDuringCompaction?: () => void;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  /** Current log row count and byte total (for tests and the compaction check). */
  get stats(): { count: number; bytes: number } {
    return { count: this.logCount, bytes: this.logBytes };
  }

  /** Whether the SQL tables exist for this board (never creates them). */
  private hasTables(): boolean {
    const row = this.sql
      .exec<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='updates'`,
      )
      .one();
    return row.c > 0;
  }

  /**
   * Read-only existence check (share.not_found, share.legacy_boards). A board
   * exists if `storage_meta.created_at` is set, OR it has any `updates` or
   * `snapshot_chunks` rows (a legacy board that predates created_at). Returns
   * false without touching (or creating) any table for a never-seen id.
   */
  existsReadOnly(): boolean {
    if (!this.hasTables()) return false;
    const created = this.sql
      .exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'created_at'`,
      )
      .toArray();
    if (created.length > 0) return true;
    const upd = this.sql.exec<{ c: number }>(`SELECT COUNT(*) AS c FROM updates`).one().c;
    if (upd > 0) return true;
    const snap = this.sql
      .exec<{ c: number }>(`SELECT COUNT(*) AS c FROM snapshot_chunks`)
      .one().c;
    return snap > 0;
  }

  /**
   * Record the board's creation time if it has not been created yet (idempotent).
   * Requires migrate() to have run. Returns true when this call created the board,
   * false when it already existed (TC-15: never re-initialised).
   */
  setCreatedAtIfAbsent(now: number): boolean {
    const existing = this.sql
      .exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'created_at'`,
      )
      .toArray();
    if (existing.length > 0) return false;
    this.sql
      .exec(
        `INSERT INTO storage_meta (key, value) VALUES (?, ?)`,
        'created_at',
        String(now),
      )
      .toArray();
    return true;
  }

  /** Read the creation timestamp, or null when the board has no created_at. */
  getCreatedAt(): number | null {
    if (!this.hasTables()) return null;
    const rows = this.sql
      .exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'created_at'`,
      )
      .toArray();
    return rows.length > 0 ? Number.parseInt(rows[0].value, 10) : null;
  }

  /** Create tables if absent and record the storage schema version. Writes no update rows. */
  migrate(): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ).toArray();
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL
      )`,
    ).toArray();
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
    ).toArray();
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      )`,
    ).toArray();

    const existing = this.sql
      .exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = ?`,
        'storage_schema_version',
      )
      .toArray();
    if (existing.length === 0) {
      this.sql
        .exec(
          `INSERT INTO storage_meta (key, value) VALUES (?, ?)`,
          'storage_schema_version',
          String(STORAGE_SCHEMA_VERSION),
        )
        .toArray();
    }
    this.tablesReady = true;
  }

  /** Append one Yjs update to the log. Rethrows SQL errors (caller resets the room). */
  append(update: Uint8Array): void {
    // Legacy path: a board with content but never explicitly initialised (no
    // created_at) still has tables from a prior session. A board reaching append
    // without tables would be a programming error, but migrate lazily to be safe.
    if (!this.tablesReady) {
      if (!this.hasTables()) this.migrate();
      else this.tablesReady = true;
    }
    const bytes = update.length;
    this.sql
      .exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, toArrayBuffer(update), bytes)
      .toArray();
    this.logCount += 1;
    this.logBytes += bytes;
  }

  /**
   * Load the snapshot then the update log into `doc`.
   *
   * Never reports an empty board on failure: any failure returns `ok:false` so the
   * caller refuses to serve an empty doc. A damaged log row is quarantined and the
   * remaining rows still apply (ok:true with a quarantined count).
   */
  load(doc: Y.Doc): LoadResult {
    // A never-created board has no tables. Treat it as an empty board WITHOUT
    // creating them, so probing an unknown link writes nothing (TC-06, TC-09).
    if (!this.hasTables()) {
      this.logCount = 0;
      this.logBytes = 0;
      return { ok: true, quarantined: 0 };
    }
    this.tablesReady = true;
    let throughSeq = 0;
    let chunkRows: { idx: number; data: ArrayBuffer }[];
    let logRows: { seq: number; data: ArrayBuffer }[];
    try {
      const meta = this.sql
        .exec<{ value: string }>(
          `SELECT value FROM storage_meta WHERE key = ?`,
          'snapshot_through_seq',
        )
        .toArray();
      throughSeq = meta.length > 0 ? Number.parseInt(meta[0].value, 10) || 0 : 0;

      chunkRows = this.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          `SELECT idx, data FROM snapshot_chunks ORDER BY idx`,
        )
        .toArray();

      logRows = this.sql
        .exec<{ seq: number; data: ArrayBuffer }>(
          `SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq`,
          throughSeq,
        )
        .toArray();
    } catch (e: unknown) {
      return { ok: false, reason: 'sql-error', error: errMessage(e) };
    }

    // Snapshot first. An unreadable snapshot is fatal: the board is mostly gone, so
    // we must not present an empty doc. Nothing is deleted or quarantined.
    if (chunkRows.length > 0) {
      const bytes = joinChunks(chunkRows.map((r) => new Uint8Array(r.data)));
      try {
        Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
      } catch (e: unknown) {
        console.error(
          JSON.stringify({ event: 'snapshot-unreadable', error: errMessage(e) }),
        );
        return { ok: false, reason: 'snapshot-unreadable', error: errMessage(e) };
      }
    }

    // Then the log rows above the snapshot watermark, oldest first.
    this.logCount = 0;
    this.logBytes = 0;
    let quarantined = 0;
    const now = Date.now();
    for (const row of logRows) {
      const update = new Uint8Array(row.data);
      try {
        Y.applyUpdate(doc, update, LOAD_ORIGIN);
        this.logCount += 1;
        this.logBytes += update.length;
      } catch (e: unknown) {
        const message = errMessage(e);
        quarantined += 1;
        // Move the row to quarantine inside a transaction so it is never lost:
        // either removed from the log and recorded, or neither.
        try {
          this.storage.transactionSync(() => {
            this.sql
              .exec(
                `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at)
                 VALUES (?, ?, ?, ?)`,
                row.seq,
                row.data,
                message,
                now,
              )
              .toArray();
            this.sql.exec(`DELETE FROM updates WHERE seq = ?`, row.seq).toArray();
          });
        } catch (qe: unknown) {
          console.error(
            JSON.stringify({ event: 'quarantine-failed', seq: row.seq, error: errMessage(qe) }),
          );
        }
        console.error(
          JSON.stringify({ event: 'quarantine', seq: row.seq, error: message }),
        );
      }
    }

    return { ok: true, quarantined };
  }

  /**
   * Compact the log into a chunked snapshot when it crosses a threshold.
   *
   * Never throws. Returns false when there is nothing to do or when the write
   * transaction rolled back (the previous snapshot and log stay intact). On a
   * successful commit the update log is truncated up to the current max seq and
   * the snapshot watermark is advanced.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;

    let state: Uint8Array;
    try {
      state = Y.encodeStateAsUpdate(doc);
    } catch (e: unknown) {
      console.error(
        JSON.stringify({ event: 'compaction-failed', stage: 'encode', error: errMessage(e) }),
      );
      return false;
    }

    const chunks = chunkBytes(state);

    try {
      const { m } = this.sql
        .exec<{ m: number }>(`SELECT COALESCE(MAX(seq), 0) AS m FROM updates`)
        .one();
      const maxSeq = m;

      this.storage.transactionSync(() => {
        this.sql.exec(`DELETE FROM snapshot_chunks`).toArray();
        for (let i = 0; i < chunks.length; i++) {
          this.sql
            .exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`, i, toArrayBuffer(chunks[i]))
            .toArray();
        }
        if (this.__failDuringCompaction) this.__failDuringCompaction();
        this.sql.exec(`DELETE FROM updates WHERE seq <= ?`, maxSeq).toArray();
        this.sql
          .exec(
            `INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`,
            'snapshot_through_seq',
            String(maxSeq),
          )
          .toArray();
      });

      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (e: unknown) {
      console.error(
        JSON.stringify({ event: 'compaction-failed', stage: 'write', error: errMessage(e) }),
      );
      return false;
    }
  }

  /**
   * TEST ONLY: fabricate an unreadable snapshot. Sets the snapshot watermark to the
   * current max log seq and stores garbage bytes as the snapshot, so a subsequent
   * load() reports `snapshot-unreadable` while every real log row is preserved
   * (the log is only pruned by real compaction, which never ran here). Used to
   * exercise the load-failure path end-to-end.
   */
  __testCorruptSnapshot(): void {
    const { m } = this.sql
      .exec<{ m: number }>(`SELECT COALESCE(MAX(seq), 0) AS m FROM updates`)
      .one();
    this.sql
      .exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`, 'snapshot_through_seq', String(m))
      .toArray();
    this.sql.exec(`DELETE FROM snapshot_chunks`).toArray();
    const garbage = new Uint8Array(24).fill(0xff);
    this.sql
      .exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`, 0, toArrayBuffer(garbage))
      .toArray();
  }

  /**
   * TEST ONLY: remove a fabricated snapshot so load() replays the full update log
   * again (works only when no real compaction pruned the log).
   */
  __testRepairSnapshot(): void {
    this.sql
      .exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`, 'snapshot_through_seq', '0')
      .toArray();
    this.sql.exec(`DELETE FROM snapshot_chunks`).toArray();
  }
}
