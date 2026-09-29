import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '@shared/config';
export { chunkBytes, joinChunks, shouldCompact } from './board-store-pure';
import { chunkBytes, joinChunks, shouldCompact } from './board-store-pure';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Marker for updates applied during load (not stored, not broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

export class BoardStore {
  private sql: SqlStorage;
  private rowCount = 0;
  private rowBytes = 0;

  constructor(private storage: DurableObjectStorage) {
    this.sql = storage.sql;
  }

  /**
   * Create tables if they don't exist. Sets storage_schema_version if absent.
   * Does NOT write any update rows.
   */
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
    // Set schema version if absent
    const existing = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`,
    ).next();
    if (!existing.done) return; // already set
    this.sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?1)`,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /**
   * Set created_at in storage_meta if not already present.
   * Returns 'created' if it was just set, 'exists' if already there.
   * Assumes tables already exist (call after migrate()).
   */
  setCreatedAtIfAbsent(): 'created' | 'exists' {
    const existing = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'created_at'`,
    ).next();
    if (!existing.done) return 'exists';
    this.sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES ('created_at', ?1)`,
      String(Date.now()),
    );
    return 'created';
  }

  /**
   * Read-only existence check. Does NOT create tables.
   * A board exists if:
   *   - storage_meta has created_at, OR
   *   - (legacy) there is at least one row in updates or snapshot_chunks.
   * If tables don't exist at all, the board does not exist.
   */
  existsReadOnly(): boolean {
    try {
      // Check if storage_meta table exists
      const tableCheck = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='storage_meta'`,
      ).next();
      if (tableCheck.done) return false; // no tables at all

      // Check created_at
      const createdRow = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'created_at'`,
      ).next();
      if (!createdRow.done) return true;

      // Legacy check: does updates table exist and have rows?
      const updatesTableCheck = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='updates'`,
      ).next();
      if (!updatesTableCheck.done) {
        const countRow = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM updates`,
        ).next();
        if (!countRow.done && countRow.value.cnt > 0) return true;
      }

      // Legacy check: does snapshot_chunks table exist and have rows?
      const snapshotTableCheck = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_chunks'`,
      ).next();
      if (!snapshotTableCheck.done) {
        const countRow = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM snapshot_chunks`,
        ).next();
        if (!countRow.done && countRow.value.cnt > 0) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Append an update to the log. Throws on SQL failure (caller handles).
   * Ensures tables exist before writing (lazy migrate for legacy boards).
   */
  append(update: Uint8Array): void {
    this.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO updates (data, bytes) VALUES (?1, ?2)`,
        update,
        update.byteLength,
      );
    });
    this.rowCount++;
    this.rowBytes += update.byteLength;
  }

  /**
   * Load the document from snapshot + log updates.
   * Treats missing tables as an empty board without creating them.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Check if tables exist; if not, treat as empty board
      const tableCheck = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='updates'`,
      ).next();
      if (tableCheck.done) {
        // No tables at all — empty board
        return { ok: true, quarantined: 0 };
      }

      // 1. Load snapshot chunks
      const chunkRows = this.sql.exec<{ idx: number; data: ArrayBuffer }>(
        `SELECT idx, data FROM snapshot_chunks ORDER BY idx`,
      ).toArray();

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
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

      // Get the through_seq to know which updates are new since last compaction
      const metaRow = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).next();
      const throughSeq = metaRow.done ? 0 : Number(metaRow.value.value);

      // 2. Load log updates after snapshot_through_seq
      const updateRows = this.sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq`,
        throughSeq,
      ).toArray();

      let quarantined = 0;
      this.rowCount = 0;
      this.rowBytes = 0;

      for (const row of updateRows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
          this.rowCount++;
          this.rowBytes += row.bytes;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`[board-store] quarantining update seq=${row.seq}: ${errorMsg}`);
          try {
            this.storage.transactionSync(() => {
              this.sql.exec(
                `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)`,
                row.seq, row.data, errorMsg, Date.now(),
              );
              this.sql.exec(`DELETE FROM updates WHERE seq = ?1`, row.seq);
            });
          } catch {
            // If quarantine itself fails, skip the row but don't fail the load
          }
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

  /**
   * Compact if thresholds are met. Never throws; returns false on no-op or rollback.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.rowBytes)) return false;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);

      const maxRow = this.sql.exec<{ seq: number }>(
        `SELECT MAX(seq) as seq FROM updates`,
      ).next();
      const maxSeq = maxRow.done ? 0 : Number(maxRow.value.seq);

      this.storage.transactionSync(() => {
        this.sql.exec(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          this.sql.exec(
            `INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`,
            i, chunks[i],
          );
        }
        if (maxSeq > 0) {
          this.sql.exec(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
        }
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          String(maxSeq),
        );
      });

      this.rowCount = 0;
      this.rowBytes = 0;
      return true;
    } catch (e) {
      console.error('[board-store] compaction failed, rolled back:', e);
      return false;
    }
  }
}
