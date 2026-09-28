/**
 * SQLite-backed persistence for one board (story 4).
 *
 * Runs inside the SQLite-backed Durable Object `BoardRoom`, using `storage.sql`
 * (the synchronous SQLite API). Every Yjs update is written with a single
 * `INSERT` before it is broadcast; state is folded into a chunked snapshot when
 * the un-compacted log passes COMPACTION_UPDATE_COUNT rows or COMPACTION_BYTES
 * bytes. Loading a board reads the snapshot chunks and the update rows written
 * after it, and quarantines - instead of crashing on - a row that will not
 * decode.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Origin used when this store writes into the Y.Doc. The room's `update`
 * handler skips it, so loading a board never re-stores the board's own state.
 */
export const LOAD_ORIGIN = 'load';

/** Meta keys held in `storage_meta`. */
export const META_SCHEMA_VERSION = 'storage_schema_version';
export const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * SQLite values as they cross the `storage.sql` boundary. `Uint8Array` is
 * accepted by the runtime for BLOB bindings and returned by some hosts.
 */
export type SqlValue = ArrayBuffer | Uint8Array | string | number | null;
export type SqlRow = Record<string, SqlValue>;

export interface SqlCursorLike {
  toArray(): SqlRow[];
}

/**
 * The part of the Durable Object storage API this store uses. Declared locally
 * so the module also type-checks outside the worker tsconfig, and so tests can
 * wrap it to inject statement-level failures (the real `DurableObjectStorage`
 * is structurally assignable to it).
 */
export interface BoardStorageLike {
  sql: {
    exec(query: string, ...bindings: SqlValue[]): SqlCursorLike;
  };
  transactionSync<T>(closure: () => T): T;
}

/** Split `data` into chunks of at most `size` bytes. Zero bytes yields no chunks. */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

/** Concatenate chunks back into one Uint8Array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Compaction trigger: row count or byte total over threshold. */
export function shouldCompact(
  count: number,
  bytes: number,
  maxCount: number = COMPACTION_UPDATE_COUNT,
  maxBytes: number = COMPACTION_BYTES,
): boolean {
  return count >= maxCount || bytes >= maxBytes;
}

/** Threshold overrides; each default is the configured value. */
export interface BoardStoreOptions {
  compactionUpdateCount?: number;
  compactionBytes?: number;
  snapshotChunkBytes?: number;
}

/** SQLite BLOB bindings are ArrayBuffer; copy defensively from any view/buffer. */
function toBlobParam(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

/** BLOB columns come back as ArrayBuffer or Uint8Array depending on the runtime. */
function toUint8(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`expected a BLOB value, got ${typeof value}`);
}

export class BoardStore {
  /** Un-compacted log stats, seeded from SQL by `load()` and kept in step after. */
  private pendingCount = 0;
  private pendingBytes = 0;
  private readonly updateCountLimit: number;
  private readonly byteLimit: number;
  private readonly chunkSize: number;

  constructor(
    private readonly storage: BoardStorageLike,
    options: BoardStoreOptions = {},
  ) {
    this.updateCountLimit = options.compactionUpdateCount ?? COMPACTION_UPDATE_COUNT;
    this.byteLimit = options.compactionBytes ?? COMPACTION_BYTES;
    this.chunkSize = options.snapshotChunkBytes ?? SNAPSHOT_CHUNK_BYTES;
  }

  /**
   * Create the schema if it does not exist and record the storage schema
   * version. Writes nothing else: a board that was never edited still has no
   * update rows.
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS updates (' +
          'seq INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          'data BLOB NOT NULL, ' +
          'bytes INTEGER NOT NULL)',
      );
      // The snapshot is one encoded Yjs update split across rows: a whole board
      // must fit the platform's per-row size limit.
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS snapshot_chunks (' +
          'idx INTEGER PRIMARY KEY, ' +
          'data BLOB NOT NULL)',
      );
      // Damaged update rows are moved here instead of being applied or dropped.
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
          'seq INTEGER PRIMARY KEY, ' +
          'data BLOB NOT NULL, ' +
          'error TEXT NOT NULL, ' +
          'quarantined_at INTEGER NOT NULL)',
      );
      const existing = this.metaGet(META_SCHEMA_VERSION);
      if (existing === undefined) {
        this.metaSet(META_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
      }
    });
  }

  /** Append one Yjs update to the log. Synchronous; throws if the write fails. */
  append(update: Uint8Array): void {
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      toBlobParam(update),
      update.length,
    );
    this.pendingCount += 1;
    this.pendingBytes += update.length;
  }

  /**
   * Rebuild `doc` from the snapshot plus every update written after it.
   * A row that fails to decode is quarantined and the load continues.
   */
  load(doc: Y.Doc): LoadResult {
    let snapshotSeq = 0;
    let chunks: Uint8Array[] = [];
    let rows: { seq: number; data: Uint8Array }[] = [];
    try {
      snapshotSeq = this.getSnapshotThroughSeq();
      chunks = this.storage.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC')
        .toArray()
        .map((row) => toUint8(row.data));
      rows = this.storage.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq ASC', snapshotSeq)
        .toArray()
        .map((row) => ({ seq: Number(row.seq), data: toUint8(row.data) }));
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorMessage(e) };
    }

    if (snapshotSeq > 0 && chunks.length === 0) {
      return {
        ok: false,
        reason: 'snapshot-unreadable',
        error: `no snapshot rows for seq ${snapshotSeq}`,
      };
    }

    if (chunks.length > 0) {
      try {
        Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
      } catch (e) {
        return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(e) };
      }
    }

    let quarantined = 0;
    let appliedCount = 0;
    let appliedBytes = 0;
    for (const row of rows) {
      try {
        Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
        appliedCount += 1;
        appliedBytes += row.data.length;
      } catch (e) {
        this.quarantine(row.seq, row.data, errorMessage(e));
        quarantined += 1;
        console.error(
          JSON.stringify({ event: 'quarantined_update', seq: row.seq, error: errorMessage(e) }),
        );
      }
    }

    this.pendingCount = appliedCount;
    this.pendingBytes = appliedBytes;
    return { ok: true, quarantined };
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (
      !shouldCompact(
        this.pendingCount,
        this.pendingBytes,
        this.updateCountLimit,
        this.byteLimit,
      )
    ) {
      return false;
    }
    try {
      this.compact(doc);
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction_failed', error: errorMessage(e) }));
      return false;
    }
  }

  /**
   * Write `doc`'s state as chunked snapshot rows and delete the folded-in
   * update rows, in one transaction. Throws (rolling the transaction back) if
   * any statement fails, leaving the previous snapshot and log intact.
   */
  compact(doc: Y.Doc): void {
    const encoded = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(encoded, this.chunkSize);
    this.storage.transactionSync(() => {
      const through = this.scalar('SELECT COALESCE(MAX(seq), 0) AS value FROM updates');
      this.storage.sql.exec('DELETE FROM snapshot_chunks');
      for (let index = 0; index < chunks.length; index++) {
        this.storage.sql.exec(
          'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
          index,
          toBlobParam(chunks[index]),
        );
      }
      this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', through);
      this.metaSet(META_SNAPSHOT_THROUGH_SEQ, String(through));
    });
    this.pendingCount = 0;
    this.pendingBytes = 0;
  }

  /** Un-compacted log stats (for tests and the compaction trigger). */
  get stats(): { count: number; bytes: number } {
    return { count: this.pendingCount, bytes: this.pendingBytes };
  }

  /** Highest update seq folded into the current snapshot (0 when there is none). */
  getSnapshotThroughSeq(): number {
    const raw = this.metaGet(META_SNAPSHOT_THROUGH_SEQ);
    return raw === undefined ? 0 : Number(raw);
  }

  /** Meta value stored in `storage_meta` (read-only helper for tests). */
  metaValue(key: string): string | undefined {
    return this.metaGet(key);
  }

  updateRowCount(): number {
    return this.scalar('SELECT COUNT(*) AS value FROM updates');
  }

  snapshotRowCount(): number {
    return this.scalar('SELECT COUNT(*) AS value FROM snapshot_chunks');
  }

  quarantinedRowCount(): number {
    return this.scalar('SELECT COUNT(*) AS value FROM quarantined_updates');
  }

  /** Move a damaged update row out of the log so the load can continue. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        toBlobParam(data),
        error,
        Date.now(),
      );
      this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  private metaGet(key: string): string | undefined {
    const rows = this.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray();
    const value = rows[0]?.value;
    return typeof value === 'string' ? value : undefined;
  }

  private metaSet(key: string, value: string): void {
    this.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  private scalar(query: string): number {
    const rows = this.storage.sql.exec(query).toArray();
    return rows.length > 0 ? Number(rows[0].value) : 0;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
