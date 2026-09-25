/**
 * Board storage in the BoardRoom's SQLite-backed Durable Object storage (anchor:
 * persist.board_store). One database per board:
 *
 *   storage_meta        key/value: storage_schema_version, snapshot_through_seq
 *   updates             append-only log of Yjs updates applied since the last snapshot
 *   snapshot_chunks     Y.encodeStateAsUpdate(doc) split into SNAPSHOT_CHUNK_BYTES rows
 *   quarantined_updates log rows that could not be applied on load, kept for inspection
 *
 * Loading applies the snapshot then every log row with seq > snapshot_through_seq. An
 * unreadable snapshot fails the whole load (nothing is modified); an unreadable log row is
 * moved to quarantine and the rest of the board loads.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin of updates applied while loading; they are neither stored nor broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_THROUGH_SEQ = 'snapshot_through_seq';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

/** Splits `data` into consecutive views of at most `size` bytes (none for empty input). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!(size > 0)) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += size) chunks.push(data.subarray(at, Math.min(at + size, data.length)));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** True when the log is long enough to be folded into the snapshot. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`expected a BLOB, got ${typeof value}`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class BoardStore {
  /** Log rows and bytes after the snapshot, tracked in memory to avoid COUNT(*) per write. */
  private logCount = 0;
  private logBytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Creates the tables and records the storage schema version. Writes no board content. */
  migrate(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.sql.exec(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Appends one applied update to the log. Throws on SQL failure (the caller resets the room). */
  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  private throughSeq(): number {
    const rows = this.sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', META_THROUGH_SEQ).toArray();
    const value = rows[0]?.value;
    return value === undefined ? 0 : Number(value);
  }

  /** Populates `doc` (expected fresh) from the snapshot and the log. Never throws. */
  load(doc: Y.Doc): LoadResult {
    try {
      const chunks = this.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((r) => toBytes(r.data));
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (err) {
          console.error(JSON.stringify({ event: 'board_store.snapshot_unreadable', error: message(err) }));
          return { ok: false, reason: 'snapshot-unreadable', error: message(err) };
        }
      }
      const through = this.throughSeq();
      const rows = this.sql
        .exec<{ seq: number; data: ArrayBuffer }>('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();
      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytes += data.length;
        } catch (err) {
          this.quarantine(row.seq, data, message(err));
          quarantined += 1;
        }
      }
      this.logCount = count;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (err) {
      console.error(JSON.stringify({ event: 'board_store.load_sql_error', error: message(err) }));
      return { ok: false, reason: 'sql-error', error: message(err) };
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board_store.update_quarantined', seq, bytes: data.length, error }));
  }

  /**
   * Folds the log into a new snapshot of `doc` (which already holds snapshot + log) when
   * shouldCompact. Atomic: on any error the previous snapshot and log are left intact.
   * Returns true only when a compaction committed; never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /** Unconditional compaction (also used by the e2e test hooks). Never throws. */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const max = this.sql.exec<{ max: number | null }>('SELECT MAX(seq) AS max FROM updates').one().max;
        const through = max ?? this.throughSeq();
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk));
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', META_THROUGH_SEQ, String(through));
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (err) {
      console.error(JSON.stringify({ event: 'board_store.compaction_failed', error: message(err) }));
      return false;
    }
  }
}
