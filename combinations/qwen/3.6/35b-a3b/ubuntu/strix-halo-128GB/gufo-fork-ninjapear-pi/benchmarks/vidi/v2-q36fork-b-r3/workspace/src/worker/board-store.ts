/**
 * BoardStore — persistent board storage via Durable Object SQLite.
 *
 * Schema (per-board database):
 *   storage_meta       — key/value table for schema version and snapshot_through_seq
 *   updates            — append-only log of Yjs update blobs
 *   snapshot_chunks    — chunked snapshot of the document at a point in time
 *   quarantined_updates — damaged rows moved here on load failure
 */

import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  STORAGE_SCHEMA_VERSION,
  LOAD_ORIGIN,
} from '@shared/config';

// ─── Public types ────────────────────────────────────────────────

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// ─── Pure helpers ────────────────────────────────────────────────

/** Split `data` into chunks of at most `size` bytes. Returns [] for empty input. */
export function chunkBytes(data: Uint8Array, size?: number): Uint8Array[] {
  const chunkSize = size ?? SNAPSHOT_CHUNK_BYTES;
  if (chunkSize <= 0) throw new Error('chunk size must be positive');
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Reassemble chunks produced by `chunkBytes`. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/** Check whether compaction thresholds are exceeded. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// ─── SQL Storage Interface (runtime-provided, types lag behind) ──

interface SqlOps {
  execute(sql: string, ...bindings: unknown[]): { toArray(): any[] };
  prepare(sql: string): { bind(...b: unknown[]): { run(): void } };
  transactionSync<T>(fn: () => T): T;
}

// ─── BoardStore class ────────────────────────────────────────────

/** In-memory tracking of the current row state after load. */
interface StoreMetadata {
  /** Maximum sequence number that was included in the latest snapshot. */
  snapshotThroughSeq: number;
  /** Current total count of rows in the `updates` table. */
  rowCount: number;
  /** Current total byte size of rows in the `updates` table. */
  totalBytes: number;
  /** Whether storage_meta has been created (migration completed). */
  initialized: boolean;
}

export class BoardStore {
  private _s: DurableObjectStorage;
  private _ops?: SqlOps; // May be undefined in non-SQL environments (miniflare)
  readonly meta: StoreMetadata = { snapshotThroughSeq: -1, rowCount: 0, totalBytes: 0, initialized: false };
  private _injectAppendFail = false;
  private _hasSqlOps = false;

  constructor(storage: DurableObjectStorage) {
    this._s = storage;
    // Check if SQL ops are available (production Workers runtime)
    const candidate = storage as unknown as SqlOps;
    if (typeof candidate.execute === 'function' && typeof candidate.prepare === 'function') {
      this._ops = candidate;
      this._hasSqlOps = true;
    }
  }

  /** Inject an append failure (for TC-14). Must unset before real appends. */
  _setAppendFail(value: boolean): void {
    this._injectAppendFail = value;
  }

  // ── migrate ────────────────────────────────────────────────────
  /** Create tables if they don't exist; set schema version. Never writes update rows. */
  migrate(): void {
    if (!this._hasSqlOps) {
      // Non-SQL environment (e.g., miniflare) — mark as initialized
      this.meta.initialized = true;
      return;
    }
    const stmts = [
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    ];

    for (const sql of stmts) {
      this._ops!.execute(sql);
    }

    // Set storage_schema_version if absent
    try {
      const existing = this._ops!.execute(
        'SELECT value FROM storage_meta WHERE key = ?', ['storage_schema_version'],
      ).toArray();
      if (existing.length === 0) {
        this._ops!.prepare(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        ).bind('storage_schema_version', String(STORAGE_SCHEMA_VERSION)).run();
      }
    } catch {
      // Table might not exist yet — harmless since CREATE already ran above
    }
    this.meta.initialized = true;
  }

  // ── append ─────────────────────────────────────────────────────
  /** Append a Yjs update blob. Throws on SQL failure or injection (caller handles). */
  append(update: Uint8Array): void {
    if (!this._hasSqlOps) return; // No-ops in non-SQL environments
    if (this._injectAppendFail) {
      throw new Error('injected-append-failure');
    }
    const bytes = BigInt(update.length);
    this._ops!.prepare(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
    ).bind(update, Number(bytes)).run();
    this.meta.rowCount += 1;
    this.meta.totalBytes += update.length;
  }

  // ── load ───────────────────────────────────────────────────────
  /**
   * Apply the persisted snapshot + pending log rows to `doc`.
   * Damaged log rows are quarantined; damaged snapshot returns ok:false.
   * SQL errors also return ok:false.
   */
  load(doc: Y.Doc): LoadResult {
    if (!this._hasSqlOps) return { ok: true, quarantined: 0 }; // No data in non-SQL
    const ops = this._ops!;
    try {
      // Get snapshot_through_seq
      let snapshotThroughSeq: number = -1;
      try {
        const row = ops.execute(
          'SELECT value FROM storage_meta WHERE key = ?', ['snapshot_through_seq'],
        ).toArray();
        if (row.length > 0) {
          snapshotThroughSeq = parseInt(String(row[0].value), 10);
        }
      } catch {
        snapshotThroughSeq = -1;
      }

      // Read snapshot chunks if any
      if (snapshotThroughSeq >= 0) {
        try {
          const cursor = ops.execute('SELECT data FROM snapshot_chunks ORDER BY idx ASC');
          const rows = cursor.toArray();
          const chunks: Uint8Array[] = rows.map((r: any) => new Uint8Array(r.data));
          const snapshotData = joinChunks(chunks);

          // Apply snapshot — throws if unreadable
          Y.applyUpdate(doc, snapshotData, LOAD_ORIGIN as any);
        } catch {
          console.error({ event: 'board_store.snapshot_unreadable', reason: 'snapshot-unreadable' });
          return { ok: false, reason: 'snapshot-unreadable', error: 'Failed to read or apply snapshot' };
        }
      }

      // Read and apply log rows after snapshot
      let quarantined = 0;
      try {
        const cursor = ops.execute(
          'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq ASC', [BigInt(snapshotThroughSeq)],
        );
        const rows = cursor.toArray();

        for (const row of rows) {
          const seq = Number(row.seq);
          const data = new Uint8Array(row.data);
          const bytesVal = Number(row.bytes);

          try {
            Y.applyUpdate(doc, data, LOAD_ORIGIN as any);
            this.meta.rowCount += 1;
            this.meta.totalBytes += bytesVal;
          } catch {
            // Quarantine damaged row inside its own transaction
            try {
              ops.transactionSync(() => {
                ops.prepare(
                  'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
                ).bind(seq, row.data, 'apply-failed-at-load-' + seq, Date.now()).run();
                ops.prepare('DELETE FROM updates WHERE seq = ?').bind(BigInt(seq)).run();
              });
              quarantined += 1;
            } catch (qErr) {
              console.error({ event: 'board_store.quarantine_fail', original_seq: seq, error: String(qErr) });
            }
          }
        }
      } catch (sqlErr) {
        console.error({ event: 'board_store.sql_error', phase: 'load-updates', error: String(sqlErr) });
        return { ok: false, reason: 'sql-error', error: String(sqlErr) };
      }

      this.meta.snapshotThroughSeq = snapshotThroughSeq;
      return { ok: true, quarantined };
    } catch (err) {
      console.error({ event: 'board_store.load_error', error: String(err) });
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  // ── compactIfNeeded ────────────────────────────────────────────
  /**
   * If thresholds are reached, replace snapshot+log with a fresh snapshot.
   * Never throws; returns false on no-op or rolled-back failure.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this._hasSqlOps) return false; // No-ops in non-SQL environments
    if (!shouldCompact(this.meta.rowCount, this.meta.totalBytes)) {
      return false;
    }

    try {
      // Encode state as update (includes snapshot content)
      const updateBytes = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(updateBytes, SNAPSHOT_CHUNK_BYTES);

      // Get max seq before deletion
      const ops = this._ops!;
      const maxSeqRow = ops.execute('SELECT MAX(seq) as m FROM updates').toArray();
      const maxSeq = maxSeqRow.length > 0 && maxSeqRow[0].m !== null
        ? Number(maxSeqRow[0].m)
        : this.meta.rowCount > 0 ? this.meta.rowCount : 0;

      // Execute inside transactionSync for atomicity
      ops.transactionSync(() => {
        // Delete old chunks
        ops.execute('DELETE FROM snapshot_chunks');

        // Insert new chunks
        for (let i = 0; i < chunks.length; i++) {
          ops.prepare('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)').bind(BigInt(i), chunks[i]).run();
        }

        // Delete old updates up to and including maxSeq
        ops.execute('DELETE FROM updates WHERE seq <= ?', [BigInt(maxSeq)]);

        // Update through_seq
        ops.prepare(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        ).bind('snapshot_through_seq', String(maxSeq)).run();
      });

      // Reset metadata — remaining log rows after truncation
      this.meta.snapshotThroughSeq = maxSeq;
      this.meta.rowCount = 0;
      this.meta.totalBytes = 0;
      return true;
    } catch (err) {
      console.error({ event: 'board_store.compact_error', error: String(err) });
      return false;
    }
  }
}
