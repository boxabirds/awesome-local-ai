/**
 * BoardStore: SQLite-backed persistence for BoardRoom (story 4).
 * Pure helpers: chunkBytes, joinChunks, shouldCompact.
 */
import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split `data` into chunks of at most `size` bytes.
 * Returns 0 chunks for empty input.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** Concatenate chunks back into a single Uint8Array. */
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

/** Whether compaction should be triggered given current log count and bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

export class BoardStore {
  private storage: DurableObjectStorage;
  private sql: SqlStorage;
  private rowCount = 0;
  private rowBytes = 0;
  private snapshotThroughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
    this.initCounters();
  }

  private initCounters(): void {
    try {
      const seqRows = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      this.snapshotThroughSeq = seqRows.length > 0 ? parseInt(seqRows[0].value, 10) : 0;

      const countRows = this.sql.exec<{ cnt: number; total: number }>(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates WHERE seq > ?`,
        this.snapshotThroughSeq,
      ).toArray();
      this.rowCount = countRows[0]?.cnt ?? 0;
      this.rowBytes = countRows[0]?.total ?? 0;
    } catch {
      // Tables may not exist yet (before migrate)
      this.rowCount = 0;
      this.rowBytes = 0;
      this.snapshotThroughSeq = 0;
    }
  }

  /** Create tables and set schema version. Writes no data rows. */
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
    ).toArray();
    if (existing.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
    // Initialize through_seq if absent
    const seqExisting = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
    ).toArray();
    if (seqExisting.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '0')`,
      );
    }
  }

  /**
   * Read-only existence check: returns true if the board has been initialized
   * (created_at set) or has legacy data (updates or snapshot_chunks rows).
   * Never creates tables.
   */
  existsReadOnly(): boolean {
    try {
      // Check if tables exist at all
      const tables = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('storage_meta', 'updates', 'snapshot_chunks')`,
      ).toArray();
      if (tables.length === 0) return false;

      // Check for created_at in storage_meta
      const hasMeta = tables.some(t => t.name === 'storage_meta');
      if (hasMeta) {
        const rows = this.sql.exec<{ value: string }>(
          `SELECT value FROM storage_meta WHERE key = 'created_at'`,
        ).toArray();
        if (rows.length > 0) return true;
      }

      // Legacy: has at least one row in updates or snapshot_chunks
      const hasUpdates = tables.some(t => t.name === 'updates');
      if (hasUpdates) {
        const rows = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM updates LIMIT 1`,
        ).toArray();
        if (rows[0] && rows[0].cnt > 0) return true;
      }

      const hasSnapshot = tables.some(t => t.name === 'snapshot_chunks');
      if (hasSnapshot) {
        const rows = this.sql.exec<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM snapshot_chunks LIMIT 1`,
        ).toArray();
        if (rows[0] && rows[0].cnt > 0) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** Check if created_at is set. Tables must already exist. */
  hasCreatedAt(): boolean {
    const rows = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'created_at'`,
    ).toArray();
    return rows.length > 0;
  }

  /** Set created_at to current epoch ms. */
  setCreatedAt(): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('created_at', ?)`,
      String(Date.now()),
    );
  }

  /** Append an update to the log. Throws on SQL failure. */
  append(update: Uint8Array): void {
    // Lazy migrate: ensure tables exist before writing
    this.migrate();
    this.sql.exec(
      `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
      update,
      update.length,
    );
    this.rowCount++;
    this.rowBytes += update.length;
  }

  /** Load snapshot + log into doc. Returns LoadResult. Treats missing tables as empty board. */
  load(doc: Y.Doc): LoadResult {
    try {
      // Check if tables exist; if not, treat as empty board
      const tables = this.sql.exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = 'storage_meta'`,
      ).toArray();
      if (tables.length === 0) {
        // No tables: empty board
        return { ok: true, quarantined: 0 };
      }
      // Load the snapshot_through_seq
      const seqRows = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      this.snapshotThroughSeq = seqRows.length > 0 ? parseInt(seqRows[0].value, 10) : 0;

      // Load snapshot chunks
      const chunkRows = this.sql.exec<{ idx: number; data: ArrayBuffer }>(
        `SELECT idx, data FROM snapshot_chunks ORDER BY idx`,
      ).toArray();

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map(r => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (err) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Load log rows after snapshot
      const logRows = this.sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq`,
        this.snapshotThroughSeq,
      ).toArray();

      this.rowCount = 0;
      this.rowBytes = 0;

      let quarantined = 0;
      for (const row of logRows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
          this.rowCount++;
          this.rowBytes += row.bytes;
        } catch (err) {
          // Quarantine this row
          const errorMsg = err instanceof Error ? err.message : String(err);
          try {
            this.storage.transactionSync(() => {
              this.sql.exec(
                `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
                row.seq, new Uint8Array(row.data), errorMsg, Date.now(),
              );
              this.sql.exec(`DELETE FROM updates WHERE seq = ?`, row.seq);
            });
          } catch (quarantineErr) {
            console.error(JSON.stringify({ type: 'quarantine-failed', seq: row.seq, error: String(quarantineErr) }));
          }
          quarantined++;
          console.error(JSON.stringify({ type: 'quarantined-update', seq: row.seq, error: errorMsg }));
        }
      }

      return { ok: true, quarantined };
    } catch (err) {
      return {
        ok: false,
        reason: 'sql-error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Compact the log into a snapshot if thresholds are met. Never throws. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.rowBytes)) return false;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);

      // Find max seq in the log
      const maxRows = this.sql.exec<{ maxSeq: number | null }>(
        `SELECT MAX(seq) as maxSeq FROM updates WHERE seq > ?`,
        this.snapshotThroughSeq,
      ).toArray();
      const maxSeq = maxRows[0]?.maxSeq;
      if (maxSeq === null || maxSeq === undefined) return false;

      try {
        this.storage.transactionSync(() => {
          // Delete old chunks
          this.sql.exec(`DELETE FROM snapshot_chunks`);
          // Insert new chunks
          for (let i = 0; i < chunks.length; i++) {
            this.sql.exec(
              `INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`,
              i, chunks[i],
            );
          }
          // Delete updates up to maxSeq
          this.sql.exec(`DELETE FROM updates WHERE seq <= ?`, maxSeq);
          // Update through_seq
          this.sql.exec(
            `UPDATE storage_meta SET value = ? WHERE key = 'snapshot_through_seq'`,
            String(maxSeq),
          );
        });
      } catch (err) {
        console.error(JSON.stringify({ type: 'compaction-failed', error: String(err) }));
        return false;
      }

      this.snapshotThroughSeq = maxSeq;
      this.rowCount = 0;
      this.rowBytes = 0;
      return true;
    } catch (err) {
      console.error(JSON.stringify({ type: 'compaction-failed', error: String(err) }));
      return false;
    }
  }
}
