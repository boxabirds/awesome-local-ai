import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import { chunkBytes, joinChunks, shouldCompact, LOAD_ORIGIN, type LoadResult } from '../shared/persistence';

export { chunkBytes, joinChunks, shouldCompact, LOAD_ORIGIN };
export type { LoadResult };

export class BoardStore {
  private sql: SqlStorage;
  private rowCount = 0;
  private rowBytes = 0;
  private migrated = false;

  constructor(private storage: DurableObjectStorage) {
    this.sql = storage.sql;
  }

  /**
   * Read-only existence check. Never creates tables.
   * A board exists if storage_meta.created_at is set, OR (legacy) if
   * there are rows in updates or snapshot_chunks.
   */
  existsReadOnly(): boolean {
    // Check if any relevant tables exist
    const tables = this.sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('storage_meta', 'updates', 'snapshot_chunks')`,
      )
      .toArray();
    if (tables.length === 0) return false;

    // Check created_at
    const hasMeta = tables.some((t: { name: string }) => t.name === 'storage_meta');
    if (hasMeta) {
      const meta = this.sql
        .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
        .toArray();
      if (meta.length > 0) return true;
    }

    // Check legacy: any updates rows
    const hasUpdates = tables.some((t: { name: string }) => t.name === 'updates');
    if (hasUpdates) {
      const rows = this.sql.exec(`SELECT 1 FROM updates LIMIT 1`).toArray();
      if (rows.length > 0) return true;
    }

    // Check legacy: any snapshot_chunks rows
    const hasSnaps = tables.some((t: { name: string }) => t.name === 'snapshot_chunks');
    if (hasSnaps) {
      const rows = this.sql.exec(`SELECT 1 FROM snapshot_chunks LIMIT 1`).toArray();
      if (rows.length > 0) return true;
    }

    return false;
  }

  migrate(): void {
    this.migrated = true;
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
    const existing = this.sql
      .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`)
      .toArray();
    if (existing.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  append(update: Uint8Array): void {
    if (!this.migrated) this.migrate();
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
      // If no tables exist, treat as empty board without creating them
      const tables = this.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_chunks'`,
        )
        .toArray();
      if (tables.length === 0) {
        return { ok: true, quarantined: 0 };
      }

      const snapshotRows = this.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          `SELECT idx, data FROM snapshot_chunks ORDER BY idx`,
        )
        .toArray();

      if (snapshotRows.length > 0) {
        const chunks = snapshotRows.map((r: { idx: number; data: ArrayBuffer }) => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: String(e) };
        }
      }

      const throughRows = this.sql
        .exec<{ value: string }>(
          `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
        )
        .toArray();
      const throughSeq = throughRows.length > 0 ? parseInt(throughRows[0]!.value, 10) : 0;

      const updateRows = this.sql
        .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
          `SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq`,
          throughSeq,
        )
        .toArray();

      let quarantined = 0;
      let appliedCount = 0;
      let appliedBytes = 0;

      for (const row of updateRows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
          appliedCount++;
          appliedBytes += row.bytes;
        } catch (e) {
          quarantined++;
          try {
            this.storage.transactionSync(() => {
              this.sql.exec(
                `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)`,
                row.seq,
                new Uint8Array(row.data),
                String(e),
                Date.now(),
              );
              this.sql.exec(`DELETE FROM updates WHERE seq = ?1`, row.seq);
            });
          } catch {
            // If quarantine itself fails, still count it and continue
          }
          console.error(JSON.stringify({ event: 'quarantine', seq: row.seq, error: String(e) }));
        }
      }

      this.rowCount = appliedCount;
      this.rowBytes = appliedBytes;

      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: String(e) };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.rowBytes)) return false;

    const maxRows = this.sql
      .exec<{ seq: number }>(`SELECT MAX(seq) as seq FROM updates`)
      .toArray();
    const maxSeq = maxRows[0]?.seq ?? 0;
    if (maxSeq === 0) return false;

    const fullState = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(fullState);

    try {
      this.storage.transactionSync(() => {
        this.sql.exec(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          this.sql.exec(
            `INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`,
            i,
            chunks[i]!,
          );
        }
        this.sql.exec(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
        const existing = this.sql
          .exec<{ value: string }>(
            `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
          )
          .toArray();
        if (existing.length > 0) {
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
      });
      this.rowCount = 0;
      this.rowBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction_error', error: String(e) }));
      return false;
    }
  }
}
