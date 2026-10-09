/**
 * Board storage (story 4, persist.board_store).
 *
 * Every board's changes live in the Durable Object's SQLite database:
 * an append-only `updates` log plus a chunked `snapshot_chunks` snapshot
 * that compaction replaces it with. Load applies the snapshot first, then
 * log rows with seq > snapshot_through_seq; damaged log rows are
 * quarantined (moved to quarantined_updates with their error) instead of
 * failing the whole board. An unreadable snapshot is fatal
 * (LoadResult.ok === false) so a room never presents a partially readable
 * board as an empty one.
 *
 * The pure helpers (chunkBytes, joinChunks, shouldCompact) are exported
 * for unit testing (TC-01, TC-02).
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';
import type { LoadFailedReason } from './room-state';

/** Origin tag for Yjs updates applied while loading from storage. */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: LoadFailedReason; error: string };

export interface CompactHooks {
  /**
   * Test-only seam: invoked inside the compaction transaction, after the
   * old snapshot chunks were deleted. Throwing rolls the whole transaction
   * back (integration test TC-11); production never passes it.
   */
  afterChunkDelete?(): void;
}

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

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

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Normalise a SQL value to a Uint8Array (workerd may hand a BLOB back as an ArrayBuffer). */
function toUint8(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    // detach views so later SQL binds always see a zero-offset full buffer
    return value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
      ? value
      : value.slice();
  }
  return new Uint8Array(value as ArrayBuffer);
}

export class BoardStore {
  private storage: DurableObjectStorage;
  /** Log rows currently held (maintained in memory; re-derived on load). */
  private rowCount = 0;
  /** Total bytes of those log rows. */
  private logBytes = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /**
   * Creates the tables if missing and records the storage schema version
   * when the key is absent (future migrations compare versions).
   */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_chunks (
        idx INTEGER PRIMARY KEY,
        data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const existing = sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version');
    if (existing.next().done) {
      sql.exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', 'storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }
  }

  /**
   * Appends one accepted update to the log. Throws on SQL failure — the
   * room catches it, resets itself and closes its sockets with 1011.
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?1, ?2)', update, update.length);
    this.rowCount += 1;
    this.logBytes += update.length;
  }

  /** True once the in-memory log counters cross either compaction threshold. */
  needsCompaction(): boolean {
    return shouldCompact(this.rowCount, this.logBytes);
  }

  /**
   * Loads the board into `doc`. The snapshot (if any) is applied first,
   * then every log row with seq > snapshot_through_seq. Rows Yjs rejects
   * are moved to quarantined_updates with their error and loading
   * continues. SQL errors anywhere return { ok: false, reason:
   * 'sql-error' } without deleting or quarantining anything.
   */
  load(doc: Y.Doc): LoadResult {
    const sql = this.storage.sql;
    try {
      const chunks: Uint8Array[] = [];
      for (const [data] of sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx').raw()) {
        chunks.push(toUint8(data));
      }
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (err) {
          return { ok: false, reason: 'snapshot-unreadable', error: String(err) };
        }
      }

      let throughSeq = 0;
      for (const [value] of sql.exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq').raw()) {
        throughSeq = Number(value);
      }

      const rows: Array<{ seq: number; data: Uint8Array; bytes: number }> = [];
      for (const [seq, data, bytes] of sql
        .exec('SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq', throughSeq)
        .raw()) {
        rows.push({ seq: Number(seq), data: toUint8(data), bytes: Number(bytes) });
      }

      let quarantined = 0;
      let keptBytes = 0;
      // A failed applyUpdate leaves the target doc in a corrupted
      // intermediate state (Yjs is not transactional), which would poison
      // every later row. So each row is validated on a mirror doc that
      // always holds exactly the state the real doc holds; a row that
      // applies on the mirror applies identically on the real doc.
      const mirror = new Y.Doc();
      for (const row of rows) {
        let error: unknown;
        try {
          Y.applyUpdate(mirror, row.data, LOAD_ORIGIN);
        } catch (err) {
          error = err;
        }
        if (error === undefined) {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
          keptBytes += row.bytes;
        } else {
          quarantined += 1;
          console.error({ event: 'update-quarantined', seq: row.seq, error: String(error) });
          sql.exec(
            'INSERT INTO quarantined_updates (seq, data, bytes, error, quarantined_at) VALUES (?1, ?2, ?3, ?4, ?5)',
            row.seq,
            row.data.buffer.slice(row.data.byteOffset, row.data.byteOffset + row.data.byteLength),
            row.bytes,
            String(error),
            Date.now(),
          );
          sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
        }
      }

      this.rowCount = rows.length - quarantined;
      this.logBytes = keptBytes;
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  /**
   * Compacts the log into a new chunked snapshot when either threshold is
   * crossed (see compact). A no-op (under threshold) returns false.
   */
  compactIfNeeded(doc: Y.Doc, hooks?: CompactHooks): boolean {
    if (!shouldCompact(this.rowCount, this.logBytes)) return false;
    return this.compact(doc, hooks);
  }

  /**
   * Forced compaction, inside one transaction: delete old chunks, insert
   * the new ones, drop log rows up to max seq, set snapshot_through_seq.
   * A failure rolls everything back and returns false. Never throws.
   * (compactIfNeeded gates this on the thresholds; test hooks call it
   * directly.)
   */
  compact(doc: Y.Doc, hooks?: CompactHooks): boolean {
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshot);
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        const maxResult = sql.exec('SELECT MAX(seq) FROM updates').raw().next();
        const maxSeq = Number(maxResult.done ? null : (maxResult.value?.[0] ?? 0));
        sql.exec('DELETE FROM snapshot_chunks');
        hooks?.afterChunkDelete?.();
        for (let idx = 0; idx < chunks.length; idx++) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)', idx, chunks[idx]);
        }
        sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', 'snapshot_through_seq', String(maxSeq));
      });
    } catch (err) {
      console.error({ event: 'compaction-failed', error: String(err) });
      return false;
    }
    this.rowCount = 0;
    this.logBytes = 0;
    return true;
  }
}
