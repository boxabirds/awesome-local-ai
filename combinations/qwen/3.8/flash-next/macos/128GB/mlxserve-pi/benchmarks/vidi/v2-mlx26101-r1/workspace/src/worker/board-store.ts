// BoardStore: the Durable Object's SQLite-backed persistence for one board.
//
// One database per board (each BoardRoom is its own object) with four tables:
//   storage_meta        key/value: storage_schema_version, snapshot_through_seq
//   updates             the append-only Yjs update log (seq, data, bytes)
//   snapshot_chunks     the compacted document, split into size-bounded rows
//   quarantined_updates log rows that failed to apply, kept for diagnosis
//
// Every update the room applies to its document is written here by `append`
// before anything is broadcast (the caller does the ordering), so a change nobody
// could yet see is never the only copy of it, and a board that has been opened is
// always exactly as it was left (persist.automatic, persist.restart,
// persist.reopen). A single damaged log row is quarantined and the rest still load
// (persist.partial_damage); an unreadable snapshot is fatal and reported, never
// presented as an empty board (persist.load_failure).
//
// The SQL API of SQLite-backed Durable Objects is synchronous, so `append` runs in
// the same turn the update was applied; Durable Objects hold outgoing WebSocket
// frames until pending storage writes are confirmed (the platform's "output gate",
// relied upon rather than reimplemented).

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin used when loading stored bytes back into a document. The
 * room skips storing and broadcasting updates whose origin is this, so replaying
 * the snapshot and log on wake never re-writes them or echoes to clients.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';

/** Outcome of loading a stored board into a document. */
export type LoadResult =
  /** The board loaded. `quarantined` damaged log rows were skipped (and moved). */
  | { ok: true; quarantined: number }
  /**
   * The board could not be loaded. `snapshot-unreadable` means most of the board
   * is unreadable (fatal); `sql-error` means the read itself failed. The room puts
   * itself in LoadFailed for either and refuses to serve an empty doc.
   */
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split `data` into chunks of at most `size` bytes. An empty input yields no
 * chunks; a size that divides the input exactly yields no trailing empty chunk.
 */
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, Math.min(i + size, data.length)));
  }
  return chunks;
}

/** Concatenate chunks back into one byte array (the inverse of `chunkBytes`). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * True when the update log has grown past a threshold and should be folded into a
 * snapshot. Either reaching its limit is enough (count first on busy boards, bytes
 * first on boards with a few huge updates).
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

type SqlRow = Record<string, ArrayBuffer | string | number | null>;

/**
 * A store bound to one board's Durable Object storage. Row count and byte total
 * are tracked in memory after a load so a hot write path never runs `COUNT(*)`;
 * compaction resets them because it truncates the log.
 */
export class BoardStore {
  private readonly storage: DurableObjectStorage;
  private readonly sql: SqlStorage;

  /** Log rows currently in `updates` (set by load, bumped by append, reset by compaction). */
  private count = 0;
  /** Total bytes of those rows. */
  private bytes = 0;
  /** The `snapshot_through_seq` value: log rows at or below it are inside the snapshot. */
  private throughSeq = 0;

  /**
   * Test-only seam (never set in production): when present, `compactIfNeeded`
   * calls it inside its transaction, and if it throws the whole transaction is
   * rolled back by `transactionSync`. It proves a failed compaction loses neither
   * the previous snapshot nor the log (TC-11). The contract signature is unchanged.
   */
  failCompaction?: () => void;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  /**
   * Create the tables if absent and record the storage schema version. Writes no
   * update rows: a board that has never been edited stays empty on disk (TC-25,
   * persist.compat "boards from before this story open empty").
   */
  migrate(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    const existing = this.sql
      .exec<SqlRow>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_SCHEMA_VERSION,
      )
      .toArray();
    if (existing.length === 0) {
      this.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /**
   * Append one Yjs update to the log. Synchronous, and rethrows any SQL error so
   * the room can reset itself (persist.save_failure). Tracks the in-memory row
   * count and byte total for compaction.
   */
  append(update: Uint8Array): void {
    // Copy the bytes: a Yjs `update` event hands back a view over an encoder
    // buffer that lib0 may reuse for a later update, so we must not let the row
    // alias it. The length is the copy's length (identical to the input's).
    const bytes = update.slice();
    this.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      bytes,
      bytes.length,
    );
    this.count += 1;
    this.bytes += bytes.length;
  }

  /**
   * Load the board into `doc`: the snapshot first, then every log row after
   * `snapshot_through_seq`, oldest first. A log row that throws on apply is moved
   * to `quarantined_updates` (with the error text) and skipped, so one damaged
   * change does not lose the board (persist.partial_damage). An unreadable snapshot
   * or an SQL error returns `ok:false` and touches nothing.
   */
  load(doc: Y.Doc): LoadResult {
    // Load reads the whole log from scratch, so it re-seeds the row/byte counters
    // from scratch too (a fresh store starts at zero; this keeps them correct even
    // if a store is reloaded).
    this.count = 0;
    this.bytes = 0;
    try {
      // 1. The snapshot, if any, reconstructed from its ordered chunks.
      const chunkRows = this.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        const bytes = joinChunks(
          chunkRows.map((row) => new Uint8Array(row.data as ArrayBuffer)),
        );
        try {
          Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
        } catch (error) {
          // Fatal: most of the board is unreadable. Report, do not delete, do not
          // quarantine the log — there is nothing safe to salvage.
          return { ok: false, reason: 'snapshot-unreadable', error: String(error) };
        }
      }

      // 2. Where the snapshot ends, so the log replay does not double-apply.
      this.throughSeq = this.readThroughSeq();

      // 3. The log after the snapshot, oldest first, applying each row.
      let quarantined = 0;
      const rows = this.sql
        .exec(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          this.throughSeq,
        )
        .toArray();
      for (const row of rows) {
        const seq = Number(row.seq);
        const data = new Uint8Array(row.data as ArrayBuffer);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          this.count += 1;
          this.bytes += data.length;
        } catch (error) {
          const message = String(error);
          this.storage.transactionSync(() => {
            this.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              seq,
              data,
              message,
              Date.now(),
            );
            this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
          });
          quarantined += 1;
          console.error(
            JSON.stringify({ event: 'board-update-quarantined', seq, error: message }),
          );
        }
      }
      return { ok: true, quarantined };
    } catch (error) {
      // The read itself failed; we cannot know what is safe, so nothing changes.
      return { ok: false, reason: 'sql-error', error: String(error) };
    }
  }

  /**
   * Fold the log into a snapshot when it has grown past a threshold. Runs in a
   * single `transactionSync`, so a mid-way failure rolls back and leaves the
   * previous snapshot and the whole log intact (persist.load must never lose data).
   * Never throws: on any error it logs and returns false (the log stays, so the
   * next append can retry). Returns false when no compaction was needed.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.count, this.bytes)) return false;
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxSeq = this.maxLogSeq();
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          this.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            i,
            chunks[i],
          );
        }
        // The fault-injection seam runs after the snapshot has been deleted and
        // new chunks written, so a throw here proves the rollback keeps the
        // *previous* snapshot and the log (TC-11).
        this.failCompaction?.();
        if (maxSeq > 0) {
          this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          META_SNAPSHOT_THROUGH,
          String(maxSeq),
        );
      });
      this.throughSeq = maxSeq;
      this.count = 0;
      this.bytes = 0;
      return true;
    } catch (error) {
      // transactionSync has rolled everything back; the previous snapshot and the
      // log are exactly as they were. Keep the counters (the log is still there) so
      // a later append retries compaction.
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', error: String(error) }),
      );
      return false;
    }
  }

  /** The stored `snapshot_through_seq`, or 0 when no snapshot has been written. */
  private readThroughSeq(): number {
    const rows = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SNAPSHOT_THROUGH)
      .toArray();
    if (rows.length === 0) return 0;
    const value = Number(rows[0]!.value);
    return Number.isFinite(value) ? value : 0;
  }

  /** Highest log row currently present (used as the new `snapshot_through_seq`). */
  private maxLogSeq(): number {
    const rows = this.sql.exec('SELECT MAX(seq) AS m FROM updates').toArray();
    const m = rows.length > 0 ? Number(rows[0]!.m) : 0;
    return Number.isFinite(m) ? m : this.throughSeq;
  }
}
