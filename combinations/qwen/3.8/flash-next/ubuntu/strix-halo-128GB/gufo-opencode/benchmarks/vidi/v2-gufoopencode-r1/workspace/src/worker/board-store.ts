import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION
} from '../shared/config';

// Origin tag for updates applied while loading from storage. The room skips
// appending and broadcasting those (they are already durable).
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

// Structural subset of DurableObjectStorage. Declared locally (rather than
// using the ambient workers-types) so this module type-checks in both the
// worker program and the plain-Node unit/component program.
export interface SqlResultLike {
  toArray(): Array<Record<string, unknown>>;
}

export interface SqlLike {
  exec(query: string, ...params: unknown[]): SqlResultLike;
}

export interface BoardStorage {
  sql: SqlLike;
  transactionSync<T>(fn: () => T): T;
}

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error' };

export interface StorageStats {
  schemaVersion: number | null;
  snapshotThroughSeq: number;
  updateCount: number;
  updateBytes: number;
  chunkCount: number;
  quarantinedCount: number;
}

// Split an update into fixed-size chunks so every row stays far below the
// per-row size limit of SQLite-backed Durable Objects.
export function chunkBytes(bytes: Uint8Array, chunkSize: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (chunkSize <= 0) throw new RangeError('chunkSize must be positive');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export function shouldCompact(
  updateCount: number,
  updateBytes: number,
  countThreshold: number = COMPACTION_UPDATE_COUNT,
  bytesThreshold: number = COMPACTION_BYTES
): boolean {
  return updateCount >= countThreshold || updateBytes >= bytesThreshold;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';
export const META_CREATED_AT = 'created_at';

// One board's log-structured persistence: a compacted snapshot in fixed-size
// chunks plus an append-only log of Yjs updates on top. Every method is
// synchronous against the Durable Object storage API; durability is decided
// per call, so the room can store-before-broadcast without awaiting.
export class BoardStore {
  // In-memory counters kept in sync by append() and refreshed from SQL when
  // the store starts (or a compaction changes the picture).
  private pendingCount = 0;
  private pendingBytes = 0;
  private countersLoaded = false;
  // True once the tables are known to exist (migrated, or observed by a
  // read). Tables are never dropped, so this only ever goes false → true.
  private tablesReady = false;

  constructor(private readonly storage: BoardStorage) {}

  tableExists(name: string): boolean {
    return (
      this.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)
        .toArray().length > 0
    );
  }

  // Read-only existence rule (share.not_found / share.legacy_boards): a board
  // exists if storage_meta has created_at, or (legacy) if there is at least
  // one update or snapshot row. Never creates tables, so probing an unknown
  // link leaves no storage behind.
  existsReadOnly(): boolean {
    if (!this.tableExists('updates')) return false;
    this.tablesReady = true;
    if (this.hasCreatedAt()) return true;
    if (this.storage.sql.exec('SELECT 1 FROM updates LIMIT 1').toArray().length > 0) return true;
    return (
      this.tableExists('snapshot_chunks') &&
      this.storage.sql.exec('SELECT 1 FROM snapshot_chunks LIMIT 1').toArray().length > 0
    );
  }

  // Record the board's creation timestamp. Returns true when this call
  // created the board, false when it already existed (TC-15).
  markCreated(): boolean {
    return this.storage.transactionSync(() => {
      if (this.hasCreatedAt()) return false;
      this.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_CREATED_AT,
        new TextEncoder().encode(String(Date.now()))
      );
      return true;
    });
  }

  private hasCreatedAt(): boolean {
    if (!this.tableExists('storage_meta')) return false;
    return this.storage.sql.exec('SELECT 1 FROM storage_meta WHERE key = ?', META_CREATED_AT).toArray().length > 0;
  }

  migrate(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value BLOB NOT NULL)'
      );
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS updates (' +
          'seq INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          'data BLOB NOT NULL, ' +
          'bytes INTEGER NOT NULL, ' +
          'created_at INTEGER NOT NULL)'
      );
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)'
      );
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
          'seq INTEGER PRIMARY KEY, ' +
          'data BLOB NOT NULL, ' +
          'error TEXT NOT NULL, ' +
          'quarantined_at INTEGER NOT NULL)'
      );
      const rows = this.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_VERSION)
        .toArray();
      if (rows.length === 0) {
        this.storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
          META_SCHEMA_VERSION,
          new TextEncoder().encode(String(STORAGE_SCHEMA_VERSION))
        );
      }
    });
    this.tablesReady = true;
    this.refreshCounters();
  }

  // Insert one update at the tail of the log. SQL errors propagate: the room
  // treats them as a storage failure and stops serving writes.
  append(update: Uint8Array): void {
    // Story 5: migrate() no longer runs on construct, so the first write of a
    // session creates the schema lazily (legacy boards already have it).
    if (!this.tablesReady) this.migrate();
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes, created_at) VALUES (?, ?, ?)',
      update,
      update.length,
      Date.now()
    );
    this.pendingCount += 1;
    this.pendingBytes += update.length;
    this.countersLoaded = true;
  }

  // Rebuild `doc` from snapshot + log. A corrupt log row is moved out of the
  // log (quarantined) and the rest of the board loads. Applying a corrupt
  // update can leave a doc half-decoded, so a failed pass is discarded and
  // replayed from scratch with the poison row skipped. A corrupt snapshot is
  // fatal: the stored history cannot be trusted, so nothing is deleted and
  // the caller enters the load-failed state.
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.tableExists('updates')) {
        // Nothing was ever stored for this board: an empty board. Load does
        // not create tables, so a never-created board stays storage-free.
        this.pendingCount = 0;
        this.pendingBytes = 0;
        this.countersLoaded = true;
        return { ok: true, quarantined: 0 };
      }
      this.tablesReady = true;
      const snapshot = this.readSnapshot();
      if (snapshot !== null) {
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch {
          return { ok: false, reason: 'snapshot-unreadable' };
        }
      }
      const throughSeq = this.getMetaNumber(META_SNAPSHOT_THROUGH_SEQ) ?? 0;
      const rows = this.storage.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq ASC', throughSeq)
        .toArray();
      const quarantined = new Set<number>();
      for (;;) {
        const trial = new Y.Doc();
        let poison: { seq: number; data: Uint8Array; error: unknown } | null = null;
        if (snapshot !== null) Y.applyUpdate(trial, snapshot, LOAD_ORIGIN);
        for (const row of rows) {
          const seq = Number(row['seq']);
          if (quarantined.has(seq)) continue;
          const data = toUint8(row['data']);
          try {
            Y.applyUpdate(trial, data, LOAD_ORIGIN);
          } catch (error) {
            poison = { seq, data, error };
            break;
          }
        }
        if (poison === null) {
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(trial), LOAD_ORIGIN);
          this.refreshCounters();
          return { ok: true, quarantined: quarantined.size };
        }
        this.quarantineRow(poison.seq, poison.data, poison.error);
        quarantined.add(poison.seq);
      }
    } catch {
      return { ok: false, reason: 'sql-error' };
    }
  }

  // Replace snapshot + log with a fresh snapshot when the log has grown past
  // either threshold. Never throws: a failure rolls the transaction back and
  // leaves the previous state untouched, so a failed compaction can only cost
  // time, never data.
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.shouldCompactNow()) return false;
    return this.compact(doc);
  }

  compact(doc: Y.Doc): boolean {
    const maxSeq = Number(
      this.storage.sql.exec('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM updates').toArray()[0]?.['max_seq'] ?? 0
    );
    const encoded = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(encoded);
    try {
      this.storage.transactionSync(() => {
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (let idx = 0; idx < chunks.length; idx += 1) {
          this.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunks[idx]);
        }
        if (maxSeq > 0) {
          this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }
        this.setMetaNumber(META_SNAPSHOT_THROUGH_SEQ, maxSeq);
      });
      return true;
    } catch (error) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: errorMessage(error) }));
      return false;
    }
  }

  stats(): StorageStats {
    return {
      schemaVersion: this.getMetaNumber(META_SCHEMA_VERSION),
      snapshotThroughSeq: this.getMetaNumber(META_SNAPSHOT_THROUGH_SEQ) ?? 0,
      updateCount: Number(this.storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]?.['n'] ?? 0),
      updateBytes: Number(
        this.storage.sql.exec('SELECT COALESCE(SUM(bytes), 0) AS b FROM updates').toArray()[0]?.['b'] ?? 0
      ),
      chunkCount: Number(this.storage.sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0]?.['n'] ?? 0),
      quarantinedCount: Number(
        this.storage.sql.exec('SELECT COUNT(*) AS n FROM quarantined_updates').toArray()[0]?.['n'] ?? 0
      )
    };
  }

  private shouldCompactNow(): boolean {
    if (!this.countersLoaded) this.refreshCounters();
    return shouldCompact(this.pendingCount, this.pendingBytes);
  }

  private refreshCounters(): void {
    const row = this.storage.sql
      .exec('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM updates')
      .toArray()[0];
    this.pendingCount = Number(row?.['n'] ?? 0);
    this.pendingBytes = Number(row?.['b'] ?? 0);
    this.countersLoaded = true;
  }

  private readSnapshot(): Uint8Array | null {
    const rows = this.storage.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC').toArray();
    if (rows.length === 0) return null;
    return joinChunks(rows.map((row) => toUint8(row['data'])));
  }

  private quarantineRow(seq: number, data: Uint8Array, error: unknown): void {
    const message = errorMessage(error);
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        message,
        Date.now()
      );
      this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'update-quarantined', seq, error: message }));
  }

  private getMetaNumber(key: string): number | null {
    const row = this.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0];
    if (row === undefined) return null;
    const parsed = Number(new TextDecoder().decode(toUint8(row['value'])));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private setMetaNumber(key: string, value: number): void {
    this.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      new TextEncoder().encode(String(value))
    );
  }
}

function toUint8(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new TypeError('expected binary value');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
