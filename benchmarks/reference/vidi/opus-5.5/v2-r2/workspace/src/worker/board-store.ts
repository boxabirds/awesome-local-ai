// One board's saved state in its Durable Object's SQLite database: an append-only
// log of Yjs updates, compacted from time to time into a chunked snapshot.
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin of updates applied while loading from storage (never stored or broadcast again). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

/** Splits `data` into consecutive chunks of at most `size` bytes (none for empty input). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`invalid chunk size ${size}`);
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.length; start += size) chunks.push(data.slice(start, start + size));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** SQLite BLOB parameters are ArrayBuffers holding exactly the bytes. */
function blob(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}

function bytesOf(value: SqlStorageValue): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`expected a BLOB, got ${typeof value}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decodes the whole update before applying it, so damaged bytes never half-apply. */
function applyWhole(doc: Y.Doc, update: Uint8Array): void {
  Y.decodeUpdate(update);
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

export class BoardStore {
  /** Log rows and bytes since the last snapshot, tracked in memory to avoid COUNT(*) per write. */
  private logCount = 0;
  private logBytes = 0;
  private readonly chunkSize: number;

  constructor(
    private readonly storage: DurableObjectStorage,
    options: { chunkBytes?: number } = {},
  ) {
    this.chunkSize = options.chunkBytes ?? SNAPSHOT_CHUNK_BYTES;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Creates the tables and records the storage schema version; writes no board content. */
  migrate(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Appends one update to the log. Throws on SQL failure (the caller resets the room). */
  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', blob(update), update.byteLength);
    this.logCount++;
    this.logBytes += update.byteLength;
  }

  /**
   * Applies the snapshot, then every later log row, to `doc`. An unreadable
   * snapshot or a SQL error is reported, never an empty board; a log row that
   * cannot be read is moved to `quarantined_updates` and the rest still load.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const through = this.snapshotThroughSeq();
      const chunks = this.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((row) => bytesOf(row.data));
      if (chunks.length > 0) {
        try {
          applyWhole(doc, joinChunks(chunks));
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: message(error) };
        }
      }
      const rows = this.sql
        .exec<{ seq: number; data: ArrayBuffer }>('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();
      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const data = bytesOf(row.data);
        try {
          applyWhole(doc, data);
          count++;
          bytes += data.byteLength;
        } catch (error) {
          this.quarantine(row.seq, data, message(error));
          quarantined++;
        }
      }
      this.logCount = count;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: message(error) };
    }
  }

  /** Compacts when the log reached a threshold. Never throws; false on no-op or rolled-back failure. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /**
   * Replaces the snapshot with `doc`'s full state and truncates the log, in one
   * transaction. `doc` must already contain the snapshot and every log row.
   */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc), this.chunkSize);
      this.storage.transactionSync(() => {
        const maxSeq = this.sql.exec<{ m: number }>('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m;
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, blob(chunk));
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.sql.exec(
          "INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          String(Math.max(maxSeq, this.snapshotThroughSeq())),
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'board-compaction-failed', error: message(error) }));
      return false;
    }
  }

  private snapshotThroughSeq(): number {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
      .toArray()[0];
    return row ? Number(row.value) : 0;
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        blob(data),
        error,
        Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board-update-quarantined', seq, bytes: data.byteLength, error }));
  }
}
