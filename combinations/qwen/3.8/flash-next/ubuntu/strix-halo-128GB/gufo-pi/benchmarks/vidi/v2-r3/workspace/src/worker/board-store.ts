/**
 * BoardStore: SQLite-backed persistence for BoardRoom.
 * Story 4: persistence.
 *
 * The contract for chunking / threshold / LoadResult lives here; the pure
 * (Cloudflare-free) implementations are in `board-store-pure.ts` and re-exported
 * below so the unit tests and the worker both import from this path.
 */
import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import { chunkBytes, joinChunks, shouldCompact, LOAD_ORIGIN } from './board-store-pure';
import type { LoadResult } from './board-store-pure';

export { chunkBytes, joinChunks, shouldCompact, LOAD_ORIGIN } from './board-store-pure';
export type { LoadResult } from './board-store-pure';

export class BoardStore {
  private storage: DurableObjectStorage;
  private sql: SqlStorage;
  private updateCount = 0;
  private updateBytes = 0;
  private snapshotThroughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  migrate(): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
    );
    // Set storage_schema_version if absent
    const existing = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`,
    ).toArray();
    if (existing.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  append(update: Uint8Array): void {
    this.sql.exec(
      `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
      update,
      update.length,
    );
    this.updateCount++;
    this.updateBytes += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      // Load snapshot
      const chunkRows = this.sql.exec<{ data: ArrayBuffer }>(
        `SELECT data FROM snapshot_chunks ORDER BY idx`,
      ).toArray();

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e: unknown) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Get snapshot_through_seq
      const metaRows = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      this.snapshotThroughSeq = metaRows.length > 0 ? parseInt(metaRows[0].value, 10) : 0;

      // Load updates after snapshot_through_seq
      const updateRows = this.sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq`,
        this.snapshotThroughSeq,
      ).toArray();

      let quarantined = 0;
      for (const row of updateRows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
        } catch (e: unknown) {
          // Quarantine this row
          const errorMsg = e instanceof Error ? e.message : String(e);
          try {
            this.storage.transactionSync(() => {
              this.sql.exec(
                `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
                row.seq,
                new Uint8Array(row.data),
                errorMsg,
                Date.now(),
              );
              this.sql.exec(`DELETE FROM updates WHERE seq = ?`, row.seq);
            });
          } catch {
            // If quarantine itself fails, skip this row anyway
          }
          quarantined++;
          console.error(JSON.stringify({ event: 'quarantine', seq: row.seq, error: errorMsg }));
        }
      }

      // Track counts for compaction decisions
      const remaining = this.sql.exec<{ cnt: number; total: number }>(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates WHERE seq > ?`,
        this.snapshotThroughSeq,
      ).toArray();
      this.updateCount = remaining.length > 0 ? remaining[0].cnt : 0;
      this.updateBytes = remaining.length > 0 ? remaining[0].total : 0;

      return { ok: true, quarantined };
    } catch (e: unknown) {
      return {
        ok: false,
        reason: 'sql-error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.updateCount, this.updateBytes)) return false;
    return this.compact(doc);
  }

  /** Compact unconditionally (used to seed test fixtures and by tests). */
  forceCompact(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  private compact(doc: Y.Doc): boolean {
    try {
      // Get max seq of updates we're about to compact
      const maxSeqRows = this.sql.exec<{ maxSeq: number | null }>(
        `SELECT MAX(seq) as maxSeq FROM updates`,
      ).toArray();
      const maxSeq = maxSeqRows[0]?.maxSeq ?? 0;
      if (maxSeq === 0) return false;

      // Encode the full doc state
      const stateBytes = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(stateBytes);

      // Use transactionSync: if callback throws, transaction rolls back
      this.storage.transactionSync(() => {
        this.sql.exec(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          this.sql.exec(
            `INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`,
            i,
            chunks[i],
          );
        }
        // Delete compacted updates
        this.sql.exec(`DELETE FROM updates WHERE seq <= ?`, maxSeq);
        // Update snapshot_through_seq
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)`,
          String(maxSeq),
        );
      });

      this.snapshotThroughSeq = maxSeq;
      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (e: unknown) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }
}
