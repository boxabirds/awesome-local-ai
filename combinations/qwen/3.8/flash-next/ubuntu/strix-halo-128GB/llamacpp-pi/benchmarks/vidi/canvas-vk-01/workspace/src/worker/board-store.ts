import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Board storage (story 4): the SQL schema of a board's Durable Object SQLite
 * database, the append/load/compaction logic over it, and the two pure helpers
 * behind compaction (chunking and the threshold test).
 *
 * One database per board, four tables:
 *
 * ```text
 * storage_meta        key/value; holds storage_schema_version and snapshot_through_seq
 * updates             the append-only log of Yjs updates (one row per change)
 * snapshot_chunks     the compacted document, split into SNAPSHOT_CHUNK_BYTES rows
 * quarantined_updates log rows that failed to apply, kept for forensics
 * ```
 *
 * SQLite in a Durable Object refuses a bound value over roughly 2 MB (measured:
 * 2049 KB is accepted, 2500 KB raises `SQLITE_TOOBIG`), and a Yjs update can
 * easily be bigger than that — pasting a 2000-note board is one update. So both
 * tables store at most `SNAPSHOT_CHUNK_BYTES` per row, and a log row carries
 * `final = 0` when the change continues in the next row. A change whose pieces
 * are all in place or not in place at all; `append` writes its rows in one
 * synchronous transaction.
 *
 * The Yjs document schema (`meta.schemaVersion`, story 2) is untouched:
 * `storage_schema_version` versions these *tables* so later stories can migrate.
 *
 * The storage API is reached through the narrow {@link BoardStorage} interface
 * (the part of a Durable Object's `storage` this module uses). It is a
 * structural match for `DurableObjectStorage`, which keeps the pure helpers
 * testable in plain Node while integration tests hand in the real engine.
 */

/** Origin stamped on updates applied while loading, so they are never re-stored. */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

/** `storage_meta` keys. */
const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

/** Outcome of loading a board's saved state into a document. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export type SqlValue = ArrayBuffer | string | number | null;

export interface SqlRows {
  toArray(): readonly Record<string, SqlValue>[];
}

/** The slice of the Durable Object storage API this module uses. */
export interface BoardStorage {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): SqlRows;
  };
  transactionSync<T>(closure: () => T): T;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL, final INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
`;

/** Split `data` into `size`-byte chunks; the last chunk carries the remainder. */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size < 1) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The inverse of {@link chunkBytes}. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** True when the update log has grown past a compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

interface MetaRow {
  value: string;
}
interface ChunkRow {
  idx: number;
  data: ArrayBuffer;
}
interface UpdateRow {
  seq: number;
  data: ArrayBuffer;
  bytes: number;
  final: number;
}
interface MaxSeqRow {
  seq: number | null;
}

function asUint8(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value);
}

/** A copy backed by its own exactly-sized buffer, ready for a BLOB binding. */
function asBlob(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export class BoardStore {
  private readonly storage: BoardStorage;

  /** Log rows and bytes above `snapshot_through_seq`, tracked to skip COUNT(*). */
  private logCount = 0;
  private logBytes = 0;

  constructor(storage: BoardStorage) {
    this.storage = storage;
  }

  /**
   * Create the tables and stamp the storage version. Writes no update rows: a
   * board that was never edited stays row-free (only the tables exist).
   */
  migrate(): void {
    this.storage.sql.exec(SCHEMA);
    const existing = this.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_VERSION)
      .toArray();
    if (existing.length === 0) {
      this.setMeta(META_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
    }
  }

  /**
   * Append one Yjs update to the log, in `SNAPSHOT_CHUNK_BYTES` rows when it is
   * too big for one. SQL errors are rethrown — the caller resets the room,
   * because a change that could not be written must not be shown to anyone as
   * saved (PRD persist.save_failure).
   */
  append(update: Uint8Array): void {
    const pieces = chunkBytes(update);
    if (pieces.length === 0) return; // an empty update carries nothing to store
    if (pieces.length === 1) {
      this.insertLogRow(pieces[0] as Uint8Array, 1);
    } else {
      // Either every piece of this change is stored or none of it.
      this.storage.transactionSync(() => {
        pieces.forEach((piece, index) => {
          this.insertLogRow(piece, index === pieces.length - 1 ? 1 : 0);
        });
      });
    }
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Apply the saved board to `doc`: the snapshot first, then every log row above
   * it in seq order. A log row that Yjs rejects is moved to
   * `quarantined_updates` and counted — one damaged change must not cost the
   * board (PRD persist.partial_damage). An unreadable snapshot, or an SQL error
   * anywhere, returns `ok: false` with nothing deleted, so the room can refuse
   * to serve a misleading empty board (PRD persist.load_failure).
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const throughSeq = this.metaNumber(META_SNAPSHOT_THROUGH_SEQ);

      const chunks = this.storage.sql
        .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
        .toArray() as unknown as ChunkRow[];
      if (chunks.length > 0) {
        const snapshot = joinChunks(chunks.map((chunk) => asUint8(chunk.data)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
        }
      }

      const rows = this.storage.sql
        .exec(
          'SELECT seq, data, bytes, final FROM updates WHERE seq > ? ORDER BY seq',
          throughSeq,
        )
        .toArray() as unknown as UpdateRow[];

      this.logCount = 0;
      this.logBytes = 0;
      let quarantined = 0;
      let pieces: Uint8Array[] = [];
      let firstSeq = 0;
      let groupBytes = 0;
      for (const row of rows) {
        if (pieces.length === 0) firstSeq = row.seq;
        pieces.push(asUint8(row.data));
        groupBytes += row.bytes;
        if (row.final !== 1) continue;

        const update = joinChunks(pieces);
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
          this.logCount += 1;
          this.logBytes += groupBytes;
        } catch (error) {
          // One damaged change must not cost the board; the rest still loads.
          this.quarantine(row.seq, firstSeq, update, describe(error));
          quarantined += 1;
        }
        pieces = [];
        groupBytes = 0;
      }
      if (pieces.length > 0) {
        // A change whose last piece never made it to disk: nothing Yjs can
        // apply, so it goes to quarantine like any other unreadable row.
        const partial = joinChunks(pieces);
        this.quarantine(rows[rows.length - 1]?.seq ?? firstSeq, firstSeq, partial, 'incomplete update');
        quarantined += 1;
      }
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }
  }

  /**
   * Fold the log into the document when it has grown, in one transaction: new
   * snapshot chunks replace the old ones, applied log rows are deleted, and
   * `snapshot_through_seq` moves up. Never throws — a failure rolls back and the
   * previous snapshot and log stay intact.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /** Compaction regardless of the thresholds (the test hook uses it directly). */
  compact(doc: Y.Doc): boolean {
    try {
      const rows = this.storage.sql
        .exec('SELECT MAX(seq) AS seq FROM updates')
        .toArray() as unknown as MaxSeqRow[];
      const maxSeq = rows[0]?.seq ?? 0;
      if (maxSeq === null) return false;

      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        this.writeSnapshotChunks(chunks);
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.setMeta(META_SNAPSHOT_THROUGH_SEQ, String(maxSeq));
      });

      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      // transactionSync already rolled back; the board is still readable.
      console.error(
        JSON.stringify({ event: 'compaction-failed', error: describe(error) }),
      );
      return false;
    }
  }

  /**
   * Overridable so tests can fail a statement in the middle of compaction.
   * Writes one snapshot row per chunk, each at most SNAPSHOT_CHUNK_BYTES.
   */
  protected writeSnapshotChunks(chunks: readonly Uint8Array[]): void {
    chunks.forEach((chunk, idx) => {
      this.storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        idx,
        asBlob(chunk),
      );
    });
  }

  /**
   * Move one logical change out of the log and keep it for forensics. Damaged
   * bytes are never deleted outright (PRD persist.partial_damage).
   */
  private quarantine(
    lastSeq: number,
    firstSeq: number,
    update: Uint8Array,
    error: string,
  ): void {
    console.error(
      JSON.stringify({ event: 'update-quarantined', seq: lastSeq, error }),
    );
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        lastSeq,
        asBlob(update),
        error,
        Date.now(),
      );
      this.storage.sql.exec('DELETE FROM updates WHERE seq >= ? AND seq <= ?', firstSeq, lastSeq);
    });
  }

  private insertLogRow(piece: Uint8Array, final: 0 | 1): void {
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes, final) VALUES (?, ?, ?)',
      asBlob(piece),
      piece.byteLength,
      final,
    );
  }

  private setMeta(key: string, value: string): void {
    this.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  private metaNumber(key: string): number {
    const rows = this.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray() as unknown as MetaRow[];
    const raw = rows[0]?.value;
    const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
