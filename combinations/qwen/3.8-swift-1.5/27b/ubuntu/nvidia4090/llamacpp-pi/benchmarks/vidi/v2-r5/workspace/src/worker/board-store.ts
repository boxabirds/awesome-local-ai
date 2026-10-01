// src/worker/board-store.ts
// SQLite-backed storage for Yjs documents in Durable Objects.
// Handles schema migration, append, load (with quarantine), and chunked compaction.

import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// ─── Pure helpers ───────────────────────────────────────────────────────────────

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, Math.min(i + size, data.length)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// ─── BoardStore class ───────────────────────────────────────────────────────────

interface SqlStorage {
  prepare(query: string): {
    run(...params: (string | number | Uint8Array | null)[]): void;
    get(...params: (string | number | Uint8Array | null)[]): Record<string, string | number | Uint8Array> | null;
    all(...params: (string | number | Uint8Array | null)[]): Record<string, string | number | Uint8Array>[];
  };
  exec(query: string): void;
}

interface SyncTransaction {
  run(fn: () => void): void;
}

interface DurableObjectStorageLike {
  sql: SqlStorage;
  transactionSync: SyncTransaction;
  kv: {
    get<T>(key: string): T | null;
    set(key: string, value: unknown): void;
  };
}

export class BoardStore {
  private storage: DurableObjectStorageLike;
  private rowCount = 0;
  private byteTotal = 0;
  private snapshotThroughSeq = 0;

  constructor(storage: DurableObjectStorageLike) {
    this.storage = storage;
  }

  migrate(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `);

    // Set schema version if absent
    const row = this.storage.sql.prepare('SELECT value FROM storage_meta WHERE key = ?').get('storage_schema_version');
    if (!row) {
      this.storage.sql.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?)').run('storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }

    // Load current state counters
    const seqRow = this.storage.sql.prepare('SELECT value FROM storage_meta WHERE key = ?').get('snapshot_through_seq');
    this.snapshotThroughSeq = seqRow ? parseInt(seqRow.value as string, 10) : 0;

    const countRow = this.storage.sql.prepare('SELECT COUNT(*) as cnt FROM updates WHERE seq > ?').get(this.snapshotThroughSeq);
    this.rowCount = countRow ? (countRow.cnt as number) : 0;

    const bytesRow = this.storage.sql.prepare('SELECT COALESCE(SUM(bytes), 0) as total FROM updates WHERE seq > ?').get(this.snapshotThroughSeq);
    this.byteTotal = bytesRow ? (bytesRow.total as number) : 0;
  }

  append(update: Uint8Array): void {
    this.storage.sql.prepare('INSERT INTO updates (data, bytes) VALUES (?, ?)').run(update, update.length);
    this.rowCount++;
    this.byteTotal += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      // Read and apply snapshot
      const chunks = this.storage.sql.prepare('SELECT data FROM snapshot_chunks ORDER BY idx').all();
      if (chunks.length > 0) {
        const snapshotBytes = joinChunks(chunks.map(c => c.data as Uint8Array));
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Read and apply log rows
      const rows = this.storage.sql.prepare('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq').all(this.snapshotThroughSeq);
      let quarantined = 0;

      for (const row of rows) {
        const seq = row.seq as number;
        const data = row.data as Uint8Array;
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          // Quarantine this row
          const error = e instanceof Error ? e.message : String(e);
          this.storage.transactionSync.run(() => {
            this.storage.sql.prepare('DELETE FROM updates WHERE seq = ?').run(seq);
            this.storage.sql.prepare('INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)').run(
              seq, data, error, Date.now()
            );
          });
          console.error('[BoardStore] Quarantined damaged update', { seq, error });
          quarantined++;
        }
      }

      return { ok: true, quarantined };
    } catch (e) {
      return {
        ok: false,
        reason: 'sql-error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;

    try {
      const state = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(state);

      // Get the max seq in the updates table
      const maxSeqRow = this.storage.sql.prepare('SELECT COALESCE(MAX(seq), 0) as max_seq FROM updates').get();
      const maxSeq = maxSeqRow ? (maxSeqRow.max_seq as number) : 0;

      this.storage.transactionSync.run(() => {
        // Delete old snapshot chunks
        this.storage.sql.prepare('DELETE FROM snapshot_chunks').run();
        // Insert new chunks
        const insertChunk = this.storage.sql.prepare('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)');
        for (let i = 0; i < chunks.length; i++) {
          insertChunk.run(i, chunks[i]);
        }
        // Delete log rows up to maxSeq
        this.storage.sql.prepare('DELETE FROM updates WHERE seq <= ?').run(maxSeq);
        // Update snapshot_through_seq
        this.storage.sql.prepare('DELETE FROM storage_meta WHERE key = ?').run('snapshot_through_seq');
        this.storage.sql.prepare('INSERT INTO storage_meta (key, value) VALUES (?, ?)').run('snapshot_through_seq', String(maxSeq));
      });

      // Update in-memory counters
      this.snapshotThroughSeq = maxSeq;
      this.rowCount = 0;
      this.byteTotal = 0;

      return true;
    } catch (e) {
      console.error('[BoardStore] Compaction failed, rolled back', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /** Reset in-memory counters (used after storage failure) */
  resetCounters(): void {
    this.rowCount = 0;
    this.byteTotal = 0;
  }

  /** Get current counters (for testing) */
  getCounters(): { rowCount: number; byteTotal: number; snapshotThroughSeq: number } {
    return { rowCount: this.rowCount, byteTotal: this.byteTotal, snapshotThroughSeq: this.snapshotThroughSeq };
  }
}
