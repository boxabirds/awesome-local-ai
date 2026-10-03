// Board storage: SQLite schema + KV for BLOB data, append, load (with quarantine), compaction.
// Uses Durable Object storage: SQL for metadata/index, KV for BLOB payloads.
//
// Design note: The platform's SQL `exec` API (available in the test environment)
// has a ~100KB statement length limit, which prevents inlining large BLOBs as hex
// literals. The `prepare`/`bind` API (available in production) would support BLOB
// columns directly, but is not exposed through the vitest-pool-workers proxy.
// Using KV for BLOB data works in both environments and supports arbitrary sizes.

import * as Y from 'yjs';
import type { DurableObjectStorage } from 'cloudflare:workers';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin marker for updates applied during load (not stored, not broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split a byte array into chunks of at most `size` bytes.
 * Returns an empty array for 0-length input.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, Math.min(i + size, data.length)));
  }
  return chunks;
}

/**
 * Join an array of byte chunks back into a single byte array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Determine whether compaction should run based on row count and byte total.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

type SqlCursor = {
  next(): { done: boolean; value: Record<string, unknown> };
};
type SqlApi = {
  exec(query: string): SqlCursor;
};

export class BoardStore {
  readonly storage: DurableObjectStorage;
  /** In-memory row count (avoid COUNT(*) per write). */
  private rowCount = 0;
  /** In-memory byte total. */
  private byteTotal = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  private get sql(): SqlApi {
    return (this.storage as any).sql;
  }

  /**
   * Create tables if they don't exist and set schema version.
   * Writes no update rows.
   */
  migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        bytes INTEGER NOT NULL,
        kv_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_chunks (
        idx INTEGER PRIMARY KEY,
        kv_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER PRIMARY KEY,
        kv_key TEXT NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      );
    `);

    // Set schema version if absent.
    const cursor = this.sql.exec(
      "SELECT value FROM storage_meta WHERE key = 'storage_schema_version'",
    );
    const row = cursor.next();
    if (row.done) {
      this.sql.exec(
        "INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', '" +
          STORAGE_SCHEMA_VERSION + "')",
      );
    }

    // Load row count and byte total into memory.
    const statsCursor = this.sql.exec(
      'SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates',
    );
    const stats = statsCursor.next();
    if (!stats.done) {
      this.rowCount = (stats.value['cnt'] as number) ?? 0;
      this.byteTotal = (stats.value['total'] as number) ?? 0;
    }
  }

  /**
   * Append an update to the log. Throws on SQL failure.
   */
  async append(update: Uint8Array): Promise<void> {
    // Use AUTOINCREMENT: insert without specifying seq, then read it back.
    // This ensures seq is always monotonically increasing even after compaction
    // deletes rows (the sqlite_sequence table tracks the high-water mark).
    this.sql.exec(
      `INSERT INTO updates (bytes, kv_key) VALUES (${update.length}, 'pending')`,
    );
    const seqCursor = this.sql.exec('SELECT last_insert_rowid() as seq');
    const seqRow = seqCursor.next();
    const seq = seqRow.done ? 0 : (seqRow.value['seq'] as number);

    const kvKey = `update:${seq}`;
    await this.storage.put(kvKey, update);

    // Update the kv_key now that we know the seq.
    this.sql.exec(`UPDATE updates SET kv_key = '${kvKey}' WHERE seq = ${seq}`);
    this.rowCount++;
    this.byteTotal += update.length;
  }

  /**
   * Load the document from storage: apply snapshot chunks, then log rows
   * with seq > snapshot_through_seq. Damaged log rows are quarantined.
   */
  async load(doc: Y.Doc): Promise<LoadResult> {
    try {
      // Get snapshot_through_seq.
      const seqCursor = this.sql.exec(
        "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'",
      );
      const seqRow = seqCursor.next();
      const throughSeq = !seqRow.done ? parseInt(seqRow.value['value'] as string, 10) : 0;

      if (throughSeq > 0) {
        // Snapshot exists — load and apply it.
        const chunkCursor = this.sql.exec(
          'SELECT idx, kv_key FROM snapshot_chunks ORDER BY idx',
        );
        const chunks: { idx: number; kvKey: string }[] = [];
        let cRow = chunkCursor.next();
        while (!cRow.done) {
          chunks.push({
            idx: cRow.value['idx'] as number,
            kvKey: cRow.value['kv_key'] as string,
          });
          cRow = chunkCursor.next();
        }

        if (chunks.length > 0) {
          const chunkData: Uint8Array[] = [];
          for (const c of chunks) {
            const data = await this.storage.get(c.kvKey);
            if (data instanceof Uint8Array) {
              chunkData.push(data);
            } else {
              return {
                ok: false,
                reason: 'snapshot-unreadable',
                error: `Missing snapshot chunk at idx ${c.idx}`,
              };
            }
          }
          const snapshotBytes = joinChunks(chunkData);
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
      }

      // Load log rows after through_seq.
      const rowsCursor = this.sql.exec(
        `SELECT seq, bytes, kv_key FROM updates WHERE seq > ${throughSeq} ORDER BY seq`,
      );
      const rows: { seq: number; bytes: number; kvKey: string }[] = [];
      let rRow = rowsCursor.next();
      while (!rRow.done) {
        rows.push({
          seq: rRow.value['seq'] as number,
          bytes: rRow.value['bytes'] as number,
          kvKey: rRow.value['kv_key'] as string,
        });
        rRow = rowsCursor.next();
      }

      let quarantined = 0;
      for (const row of rows) {
        const data = await this.storage.get(row.kvKey);
        if (!(data instanceof Uint8Array)) {
          // Missing data — quarantine.
          const error = 'Missing KV data';
          const now = Date.now();
          const qKey = `quarantined:${row.seq}`;
          await this.storage.put(qKey, new Uint8Array(0));
          this.storage.transactionSync(() => {
            this.sql.exec(
              `INSERT OR REPLACE INTO quarantined_updates (seq, kv_key, error, quarantined_at) ` +
              `VALUES (${row.seq}, '${qKey}', '${error.replace(/'/g, "''")}', ${now})`,
            );
            this.sql.exec(`DELETE FROM updates WHERE seq = ${row.seq}`);
          });
          this.rowCount--;
          this.byteTotal -= row.bytes;
          quarantined++;
          continue;
        }
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          // Quarantine this row.
          const error = (e instanceof Error ? e.message : String(e)).replace(/'/g, "''");
          const now = Date.now();
          const qKey = `quarantined:${row.seq}`;
          await this.storage.put(qKey, data);
          this.storage.transactionSync(() => {
            this.sql.exec(
              `INSERT OR REPLACE INTO quarantined_updates (seq, kv_key, error, quarantined_at) ` +
              `VALUES (${row.seq}, '${qKey}', '${error}', ${now})`,
            );
            this.sql.exec(`DELETE FROM updates WHERE seq = ${row.seq}`);
          });
          this.rowCount--;
          this.byteTotal -= row.bytes;
          quarantined++;
          console.error(
            JSON.stringify({ event: 'update-quarantined', seq: row.seq, error }),
          );
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

  /**
   * Compact if thresholds are met. Never throws; returns false on no-op
   * or rolled-back failure.
   */
  async compactIfNeeded(doc: Y.Doc): Promise<boolean> {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);

      // Find the max seq in the current log.
      const maxSeqCursor = this.sql.exec('SELECT COALESCE(MAX(seq), 0) as maxSeq FROM updates');
      const maxSeqRow = maxSeqCursor.next();
      const maxSeq = maxSeqRow.done ? 0 : (maxSeqRow.value['maxSeq'] as number);

      // Store new snapshot chunks in KV.
      const newKvKeys: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const kvKey = `snapshot:${maxSeq}:${i}`;
        await this.storage.put(kvKey, chunks[i]);
        newKvKeys.push(kvKey);
      }

      // Atomic swap in SQL.
      this.storage.transactionSync(() => {
        // Delete old snapshot chunks.
        this.sql.exec('DELETE FROM snapshot_chunks');
        // Insert new chunks.
        for (let i = 0; i < newKvKeys.length; i++) {
          this.sql.exec(
            `INSERT INTO snapshot_chunks (idx, kv_key) VALUES (${i}, '${newKvKeys[i]}')`,
          );
        }
        // Delete log rows up to maxSeq.
        this.sql.exec(`DELETE FROM updates WHERE seq <= ${maxSeq}`);
        // Update snapshot_through_seq.
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '${maxSeq}')`,
        );
      });

      // Reset in-memory counters.
      this.rowCount = 0;
      this.byteTotal = 0;

      return true;
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return false;
    }
  }
}
