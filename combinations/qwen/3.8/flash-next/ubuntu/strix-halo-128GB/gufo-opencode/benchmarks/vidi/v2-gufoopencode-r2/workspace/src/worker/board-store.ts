// Board persistence on Durable Object SQLite (persist.board_store): an
// append-only update log plus a compacted, chunked snapshot. Every update is
// appended the moment it is applied, so nothing depends on anyone pressing
// save. The storage dependency is typed structurally so this module also
// loads in plain node (unit tests); at runtime it is a DurableObjectStorage.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// Origin marker for updates applied during load: the room neither stores nor
// broadcasts them (defensive check; the handler is usually not attached yet).
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

export interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(closure: () => T): T;
}

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`expected BLOB value, got ${typeof value}`);
}

export class BoardStore {
  private readonly storage: StorageLike;
  private readonly sql: SqlLike;
  // Log size is tracked in memory (set by load, maintained by append) so the
  // compaction check never runs COUNT(*) per write.
  private logCount = 0;
  private logBytes = 0;

  constructor(storage: StorageLike) {
    this.storage = storage;
    this.sql = storage.sql;
  }

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
    this.sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  // Throws on SQL failure; the room turns that into a storage-failed reset.
  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.byteLength);
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  // Applies everything to a scratch doc first: a damaged row can leave the
  // partially built scratch discarded while the caller's live doc stays
  // exactly as it was (the client must never see a half-loaded board).
  load(doc: Y.Doc): LoadResult {
    try {
      const scratch = new Y.Doc();
      const chunkRows = this.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        try {
          Y.applyUpdate(
            scratch,
            joinChunks(chunkRows.map((row) => toBytes(row.data))),
            LOAD_ORIGIN,
          );
        } catch (error) {
          // Fatal: most of the board is unreadable. Nothing is deleted.
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
      const through = this.getMetaNumber('snapshot_through_seq');
      const rows = this.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();
      let quarantined = 0;
      let appliedCount = 0;
      let appliedBytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(scratch, data, LOAD_ORIGIN);
          appliedCount += 1;
          appliedBytes += data.byteLength;
        } catch (error) {
          quarantined += 1;
          this.quarantine(Number(row.seq), data, error);
        }
      }
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch), LOAD_ORIGIN);
      this.logCount = appliedCount;
      this.logBytes = appliedBytes;
      return { ok: true, quarantined };
    } catch (error) {
      return {
        ok: false,
        reason: 'sql-error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  // Compaction regardless of thresholds; compactIfNeeded and tests use it.
  // Never throws: a failure rolls the transaction back (previous snapshot
  // and log intact) and returns false.
  compact(doc: Y.Doc): boolean {
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      this.storage.transactionSync(() => {
        const previousThrough = this.getMetaNumber('snapshot_through_seq');
        const maxRow = this.sql
          .exec('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM updates')
          .toArray()[0];
        const through = Math.max(previousThrough, Number((maxRow as { max_seq: number }).max_seq));
        this.sql.exec('DELETE FROM snapshot_chunks');
        for (let idx = 0; idx < chunks.length; idx++) {
          this.insertSnapshotChunk(idx, chunks[idx]);
        }
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.sql.exec(
          "INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          String(through),
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  // Seam inside the compaction transaction (tests inject failures here to
  // prove rollback keeps the previous snapshot and the log intact).
  insertSnapshotChunk(idx: number, data: Uint8Array): void {
    this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, data);
  }

  private quarantine(seq: number, data: Uint8Array, error: unknown): void {
    console.error(
      JSON.stringify({
        event: 'quarantine-update',
        seq,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error instanceof Error ? error.message : String(error),
        Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  private getMetaNumber(key: string): number {
    const rows = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray();
    if (rows.length === 0) return 0;
    const value = Number(rows[0].value);
    return Number.isFinite(value) ? value : 0;
  }
}
