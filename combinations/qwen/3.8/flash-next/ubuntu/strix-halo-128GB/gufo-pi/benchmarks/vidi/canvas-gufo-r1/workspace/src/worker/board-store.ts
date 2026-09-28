import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import { chunkBytes, joinChunks, shouldCompact } from './board-store-utils';

export { chunkBytes, joinChunks, shouldCompact } from './board-store-utils';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export const LOAD_ORIGIN: unique symbol = Symbol('load');

export class BoardStore {
  private sql: SqlStorage;
  private storage: DurableObjectStorage;
  private rowCount = 0;
  private rowBytes = 0;
  private migrated = false;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  migrate(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`);

    const existing = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`,
    ).toArray();
    if (existing.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?1)`,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
    this.migrated = true;
  }

  /**
   * Read-only existence check. Never writes. Returns false if no tables exist.
   * A board exists if storage_meta has created_at, OR (legacy) has rows in updates/snapshot_chunks.
   */
  existsReadOnly(): boolean {
    try {
      const tables = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='storage_meta'`,
      ).toArray();
      if (tables.length === 0) return false;

      // Check for created_at
      try {
        const meta = this.sql.exec<{ value: string }>(
          `SELECT value FROM storage_meta WHERE key = 'created_at'`,
        ).toArray();
        if (meta.length > 0) return true;
      } catch {
        // storage_meta schema may be corrupt; tables exist so board exists
        return true;
      }

      // Legacy check: any rows in updates or snapshot_chunks
      try {
        const updates = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM updates LIMIT 1`,
        ).toArray();
        if (updates[0]!.cnt > 0) return true;
      } catch {
        // table doesn't exist
      }
      try {
        const snaps = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM snapshot_chunks LIMIT 1`,
        ).toArray();
        if (snaps[0]!.cnt > 0) return true;
      } catch {
        // table doesn't exist
      }

      return false;
    } catch {
      return false;
    }
  }

  append(update: Uint8Array): void {
    if (!this.migrated) {
      this.migrate();
    }
    this.sql.exec(
      `INSERT INTO updates (data, bytes) VALUES (?1, ?2)`,
      update,
      update.length,
    );
    this.rowCount++;
    this.rowBytes += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      // If tables don't exist (never-initialized board), treat as empty
      const tableCheck = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='storage_meta'`,
      ).toArray();
      if (tableCheck.length === 0) {
        return { ok: true, quarantined: 0 };
      }

      // Read snapshot_through_seq
      const metaRows = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      const snapshotThroughSeq = metaRows.length > 0 ? Number(metaRows[0]!.value) : 0;

      // Load snapshot chunks
      const chunkRows = this.sql.exec<{ data: ArrayBuffer }>(
        `SELECT data FROM snapshot_chunks ORDER BY idx`,
      ).toArray();

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: String(e) };
        }
      }

      // Load log rows after snapshot
      const logRows = this.sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq`,
        snapshotThroughSeq,
      ).toArray();

      let quarantined = 0;
      for (const row of logRows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
        } catch (e) {
          // Quarantine the damaged row
          try {
            this.sql.exec(
              `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)`,
              row.seq, new Uint8Array(row.data), String(e), Date.now(),
            );
            this.sql.exec(`DELETE FROM updates WHERE seq = ?1`, row.seq);
          } catch {
            console.error(JSON.stringify({ event: 'quarantine_failed', seq: row.seq, error: String(e) }));
          }
          quarantined++;
        }
      }

      // Track remaining count and bytes for compaction threshold
      this.rowCount = logRows.length - quarantined;
      this.rowBytes = logRows.reduce((sum: number, r) => sum + r.bytes, 0);

      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: String(e) };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.rowBytes)) return false;

    try {
      const state = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(state);

      // Find max seq in updates
      const maxRows = this.sql.exec<{ maxSeq: number | null }>(
        `SELECT MAX(seq) as maxSeq FROM updates`,
      ).toArray();
      const maxSeq = maxRows[0]?.maxSeq ?? 0;

      // Replace snapshot, update meta, then delete consumed rows.
      // Yjs applyUpdate is idempotent: if a crash occurs between writing
      // the snapshot and deleting consumed rows, the next load replays
      // them harmlessly. This avoids transactionSync which blocks the event loop.

      // Write new snapshot chunks
      this.sql.exec(`DELETE FROM snapshot_chunks`);
      for (let i = 0; i < chunks.length; i++) {
        this.sql.exec(
          `INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`,
          i, chunks[i],
        );
      }

      // Update snapshot_through_seq
      const existingThrough = this.sql.exec<{ key: string }>(
        `SELECT key FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      if (existingThrough.length > 0) {
        this.sql.exec(
          `UPDATE storage_meta SET value = ?1 WHERE key = 'snapshot_through_seq'`,
          String(maxSeq),
        );
      } else {
        this.sql.exec(
          `INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
          String(maxSeq),
        );
      }

      // Delete consumed log rows (after snapshot is safely written)
      if (maxSeq > 0) {
        this.sql.exec(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
      }

      // Reset counters
      this.rowCount = 0;
      this.rowBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction_failed', error: String(e) }));
      return false;
    }
  }
}
