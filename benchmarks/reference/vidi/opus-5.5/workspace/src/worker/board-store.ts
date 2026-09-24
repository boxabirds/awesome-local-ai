/**
 * BoardStore: a board's saved state in its Durable Object's SQLite database.
 *
 *   storage_meta         key/value: storage_schema_version, snapshot_through_seq
 *   updates              the update log: every Yjs update the room applied, in order
 *   snapshot_chunks      the compacted board (Y.encodeStateAsUpdate) split into rows
 *   quarantined_updates  log rows that could not be read, kept for diagnosis
 *
 * Loading applies the snapshot, then every log row after `snapshot_through_seq`. A damaged
 * log row is moved to quarantine and the rest of the board loads; a damaged snapshot (most of
 * the board) or an SQL error makes the load fail, deleting nothing.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin of updates applied while loading: they are neither stored nor broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export const META_SCHEMA_VERSION = 'storage_schema_version';
export const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
] as const;

/** Splits `data` into consecutive slices of at most `size` bytes (none for empty input). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`invalid chunk size ${size}`);
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += size) {
    chunks.push(data.subarray(start, Math.min(start + size, data.byteLength)));
  }
  return chunks;
}

/** Concatenates chunks back into one byte array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** True when the log has reached COMPACTION_UPDATE_COUNT rows or COMPACTION_BYTES bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** An ArrayBuffer holding exactly `bytes` (SQL bindings take ArrayBuffer for BLOBs). */
function blob(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError('stored value is not a BLOB');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies an update, refusing bytes that do not decode. `Y.decodeUpdate` parses the whole
 * update first, so a truncated update is rejected before anything is integrated (applyUpdate
 * alone can integrate the structs of a truncated update and then throw on its delete set).
 */
export function applyCheckedUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
  Y.decodeUpdate(update);
  Y.applyUpdate(doc, update, origin);
}

type SqlValue = ArrayBuffer | string | number | null;
type Row = Record<string, unknown>;

/**
 * The part of DurableObjectStorage used here. Declared structurally so this module type-checks
 * without the Workers global types (unit tests import its pure functions under DOM types).
 */
export interface SqlStorageLike {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): Row[]; one(): Row } };
  transactionSync<T>(fn: () => T): T;
}

export interface BoardStoreOptions {
  /** Snapshot row size; tests use a small value to exercise many chunks. */
  snapshotChunkBytes?: number;
}

export class BoardStore {
  /** Log rows after the snapshot, and their total bytes (tracked in memory after load). */
  private logCount = 0;
  private logBytes = 0;
  private readonly chunkSize: number;

  constructor(
    private readonly storage: SqlStorageLike,
    options: BoardStoreOptions = {},
  ) {
    this.chunkSize = options.snapshotChunkBytes ?? SNAPSHOT_CHUNK_BYTES;
  }

  /** Every SQL statement goes through here (tests wrap it to inject failures). */
  sql(query: string, ...bindings: SqlValue[]): { toArray(): Row[]; one(): Row } {
    return this.storage.sql.exec(query, ...bindings);
  }

  /** Creates the tables and records the storage schema version. Writes no log or snapshot rows. */
  migrate(): void {
    for (const statement of SCHEMA) this.sql(statement);
    this.sql(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Appends one update to the log. Throws on SQL failure (the room then resets itself). */
  append(update: Uint8Array): void {
    this.sql('INSERT INTO updates (data, bytes) VALUES (?, ?)', blob(update), update.byteLength);
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /** Log rows and bytes after the snapshot, as tracked since load. */
  logSize(): { count: number; bytes: number } {
    return { count: this.logCount, bytes: this.logBytes };
  }

  /** Loads the saved board into `doc` (updates applied with LOAD_ORIGIN). */
  load(doc: Y.Doc): LoadResult {
    let through: number;
    let chunks: Uint8Array[];
    try {
      through = this.throughSeq();
      chunks = this.sql('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((row) => asBytes(row.data));
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: message(error) };
    }

    if (chunks.length > 0) {
      try {
        applyCheckedUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
      } catch (error) {
        return { ok: false, reason: 'snapshot-unreadable', error: message(error) };
      }
    }

    let quarantined = 0;
    let count = 0;
    let bytes = 0;
    try {
      const rows = this.sql('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through).toArray();
      for (const row of rows) {
        const seq = Number(row.seq);
        const data = asBytes(row.data);
        try {
          applyCheckedUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytes += data.byteLength;
        } catch (error) {
          this.quarantine(seq, data, message(error));
          quarantined += 1;
        }
      }
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: message(error) };
    }
    this.logCount = count;
    this.logBytes = bytes;
    return { ok: true, quarantined };
  }

  /** Compacts when the log has reached a threshold. Never throws; false on no-op or failure. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /**
   * Replaces the snapshot with `doc`'s full state and truncates the log it covers, in one
   * transaction. `doc` must hold everything stored (the room's in-memory doc does). Never
   * throws: on failure the transaction rolls back, leaving the previous snapshot and log.
   */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc), this.chunkSize);
      this.storage.transactionSync(() => {
        const maxSeq = Number(this.sql('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m);
        const through = Math.max(maxSeq, this.throughSeq());
        this.sql('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.sql('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, blob(chunk));
        });
        this.sql('DELETE FROM updates WHERE seq <= ?', through);
        this.sql(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          META_SNAPSHOT_THROUGH_SEQ,
          String(through),
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'board-store.compaction-failed', error: message(error) }));
      return false;
    }
  }

  private throughSeq(): number {
    const rows = this.sql('SELECT value FROM storage_meta WHERE key = ?', META_SNAPSHOT_THROUGH_SEQ).toArray();
    const value = rows[0]?.value;
    return value === undefined ? 0 : Number(value);
  }

  /** Moves a damaged log row to quarantined_updates (atomically). */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.sql(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        blob(data),
        error,
        Date.now(),
      );
      this.sql('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board-store.update-quarantined', seq, error }));
  }
}
