/**
 * BoardStore — SQLite-backed Durable Object storage for board persistence.
 * Story 4 — persistence.
 * Story 5 — lazy migration, existsReadOnly.
 *
 * Wraps DurableObjectStorage (SQL + transactionSync) to provide append,
 * load-with-quarantine, and compaction operations on Yjs update logs.
 */
import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '@/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from './board-store';

const LOAD_ORIGIN = Symbol('load-origin');

// ─── Public types ────────────────────────────────────────────────────

export type LoadResult =
  | { ok: true; quarantined: number; tablesExist: boolean }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// ─── Schema constants ────────────────────────────────────────────────

const SCHEMA_VERSION_KEY = 'storage_schema_version';
const SNAPSHOTT_THROUGH_SEQ_KEY = 'snapshot_through_seq';

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
`;

// ─── BoardStore class ────────────────────────────────────────────────

export class BoardStore {
  private doc?: Y.Doc;        // reference set during load/compact for byte tracking
  private rowOffset = 0;       // offset for AUTOINCREMENT when we manually manage seq

  constructor(private storage: DurableObjectStorage) {}

  /**
   * Create all tables if absent; set schema version.
   * Does not create any update rows.
   * Story 5: called lazily from BoardRoom.initialize() and before first append().
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(CREATE_TABLES_SQL);
      // Set schema version if no meta exists yet
      const existing = this.storage.sql.exec(
        'SELECT value FROM storage_meta WHERE key = ?',
        SCHEMA_VERSION_KEY,
      ).next();
      if (existing.done) {
        this.storage.sql.exec(
          "INSERT INTO storage_meta (key, value) VALUES (?, ?)",
          SCHEMA_VERSION_KEY,
          String(STORAGE_SCHEMA_VERSION),
        );
      }
    });
  }

  /**
   * Read-only existence check: does the board have created_at, or legacy data?
   * Does NOT create any tables. Returns false if tables don't exist.
   */
  existsReadOnly(): boolean {
    try {
      const row = this.storage.sql.exec(
        "SELECT value FROM storage_meta WHERE key = ?",
        '_story5_created_at',
      ).next();
      // row.done === false means row found
      if (!row.done && (row.value as unknown as Record<string, string>)?.value) return true;
      return true;
    } catch {
      // tables don't exist — board is unknown
      return false;
    }
  }

  /**
   * Append an update to the log. Throws on SQL failure.
   * Story 5: lazy migration ensures tables exist for legacy boards.
   */
  append(update: Uint8Array): void {
    // Lazy migration for legacy boards that have tables but no created_at
    try {
      this.migrate();
    } catch { /* ignore — will fail on INSERT if truly broken */ }
    const bytes = update.length;
    const result = this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update.buffer as ArrayBuffer,
      bytes,
    );
    // We don't need the last insert id for our use case
  }

  /**
   * Load the document state from storage into the provided Y.Doc.
   * Reads snapshot chunks → applies snapshot, then applies remaining log rows.
   * Damaged log rows are quarantined; damaged snapshots return LoadResult.ok:false.
   * Story 5: does NOT create tables — returns tablesExist flag.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Check if tables exist (story 5: unknown boards have no tables)
      let tablesExist = false;
      try {
        this.storage.sql.exec('SELECT 1 FROM storage_meta LIMIT 1').next();
        tablesExist = true;
      } catch {
        // No tables — empty board, nothing to load
      }

      if (!tablesExist) {
        return { ok: true, quarantined: 0, tablesExist: false };
      }

      // Step 1: Read and apply snapshot if present
      const throughSeq = this.readSnapshotThroughSeq();
      const snapLoaded = this.loadSnapshot(doc, throughSeq);
      if (!snapLoaded.ok) {
        return snapLoaded;
      }

      // Step 2: Apply log rows after the snapshot
      let quarantined = 0;
      try {
        const cursor = this.storage.sql.exec<{ seq: number; data: ArrayBuffer }>(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          throughSeq,
        );
        const rows: Array<{ seq: number; data: ArrayBuffer }> = [];
        while (true) {
          const next = cursor.next();
          if (next.done) break;
          rows.push(next.value);
        }

        for (const row of rows) {
          try {
            const update = new Uint8Array(row.data);
            Y.applyUpdate(doc, update, LOAD_ORIGIN);
          } catch (err) {
            // Quarantine this row
            this.quarantineRow(row.seq, row.data, err instanceof Error ? err.message : 'apply-update-failed');
            quarantined++;
          }
        }
      } catch (_err) {
        // SQL error during read → report sql-error
        return { ok: false, reason: 'sql-error', error: String(_err) };
      }

      return { ok: true, quarantined, tablesExist: true };
    } catch (_err) {
      return { ok: false, reason: 'sql-error', error: String(_err) };
    }
  }

  /**
   * If compaction thresholds are met, replace snapshot + truncate log.
   * Never throws; returns true on successful compaction (including no-op).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    this.doc = doc;
    let count = 0, bytes = 0;
    try {
      const countRow = this.storage.sql.exec<{ c: number }>('SELECT COUNT(*) as c FROM updates').next();
      if (!countRow.done) count = Number(countRow.value.c);
    } catch { /* can't count — skip compact */ }
    try {
      const bytesRow = this.storage.sql.exec<{ b: number }>('SELECT COALESCE(SUM(bytes), 0) as b FROM updates').next();
      if (!bytesRow.done) bytes = Number(bytesRow.value.b);
    } catch { /* can't sum — skip compact */ }

    if (!shouldCompact(count, bytes)) {
      return false;
    }

    try {
      return this.doCompact(doc);
    } catch (err) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: String(err) }));
      return false;
    } finally {
      this.doc = undefined;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private readSnapshotThroughSeq(): number {
    const row = this.storage.sql.exec<{ v: string }>(
      "SELECT value FROM storage_meta WHERE key = ?",
      SNAPSHOTT_THROUGH_SEQ_KEY,
    ).next();
    if (row.done || !row.value.v) return -1;
    return parseInt(row.value.v, 10);
  }

  private loadSnapshot(doc: Y.Doc, throughSeq: number): LoadResult {
    const cursor = this.storage.sql.exec<{ idx: number; data: ArrayBuffer }>(
      'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
    );
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = cursor.next();
      if (next.done) break;
      chunks.push(new Uint8Array(next.value.data));
    }

    if (chunks.length === 0) {
      return { ok: true, quarantined: 0, tablesExist: true }; // No snapshot — but tables exist (legacy)
    }

    try {
      const joined = joinChunks(chunks);
      Y.applyUpdate(doc, joined, LOAD_ORIGIN);
    } catch {
      return { ok: false, reason: 'snapshot-unreadable', error: 'Failed to decode snapshot' };
    }

    return { ok: true, quarantined: 0, tablesExist: true };
  }

  private quarantineRow(seq: number, data: ArrayBuffer, error: string): void {
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
      seq,
      data,
      error.slice(0, 500),
      Date.now(),
    );
    // Remove from updates
    this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
  }

  private doCompact(doc: Y.Doc): boolean {
    const stateUpdate = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(stateUpdate);

    // Get max seq in updates before deletion
    const maxSeqRow = this.storage.sql.exec<{ s: number }>(
      'SELECT COALESCE(MAX(seq), 0) as s FROM updates',
    ).next();
    const maxSeq = maxSeqRow.done ? 0 : Number(maxSeqRow.value.s);

    try {
      this.storage.transactionSync(() => {
        // Delete old snapshot chunks
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        // Insert new ones
        for (let i = 0; i < chunks.length; i++) {
          this.storage.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            i,
            chunks[i].buffer as ArrayBuffer,
          );
        }
        // Delete log rows up to and including maxSeq
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        // Update through_seq
        this.storage.sql.exec(
          "INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)",
          SNAPSHOTT_THROUGH_SEQ_KEY,
          String(maxSeq),
        );
      });
    } catch {
      throw new Error('Compaction transaction failed');
    }

    return true;
  }
}
