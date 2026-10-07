import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';
import { LOAD_ORIGIN } from '../shared/room-state';

// ---------------------------------------------------------------------------
// Pure helper functions (TC-01, TC-02)
// ---------------------------------------------------------------------------

/**
 * Split a Uint8Array into chunks of at most `size` bytes.
 */
export function chunkBytes(data: Uint8Array, size?: number): Uint8Array[] {
  const s = size ?? SNAPSHOT_CHUNK_BYTES;
  if (s <= 0) throw new Error('chunk size must be positive');
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += s) {
    chunks.push(data.slice(offset, offset + s));
  }
  return chunks;
}

/**
 * Rejoin chunks produced by `chunkBytes`. Round-trips byte-identically.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.length;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/**
 * Return true if compaction should be triggered given the current log
 * row count and approximate byte total.
 */
export function shouldCompact(
  count: number,
  bytes: number,
): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// ---------------------------------------------------------------------------
// LoadResult type (persist.board_store contract)
// ---------------------------------------------------------------------------

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// ---------------------------------------------------------------------------
// BoardStore — wraps DurableObject SQLite storage for one board
// ---------------------------------------------------------------------------

const STORAGE_META_KEY_SCHEMA_VERSION = 'storage_schema_version';
const STORAGE_META_KEY_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

// SQL schema (CREATE TABLE IF NOT EXISTS)
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
`;

type MetaRow = { key: string; value: string };
type UpdateRow = { seq: number; data: ArrayBuffer; bytes: number };
type ChunkRow = { idx: number; data: ArrayBuffer };

export class BoardStore {
  private readonly storage: DurableObjectStorage;

  // In-memory counters to avoid COUNT(*) on every write
  private _updateCount = 0;
  private _updateBytes = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /** Create tables and set schema version if absent. Writes no update rows. */
  migrate(): void {
    this.storage.sql.exec(SCHEMA_SQL);

    // Set schema version only if not already present
    const existing = this.storage.sql.exec<MetaRow>(
      "SELECT value FROM storage_meta WHERE key = ?",
      [STORAGE_META_KEY_SCHEMA_VERSION],
    ).toArray();

    if (existing.length === 0) {
      this.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        [STORAGE_META_KEY_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION)],
      );
    }
  }

  /** Append an update to the log. Throws on SQL failure. */
  append(update: Uint8Array): void {
    const len = update.byteLength;
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      [new Uint8Array(update).buffer.slice(update.byteOffset, update.byteOffset + update.byteLength), len],
    );
    this._updateCount++;
    this._updateBytes += len;
  }

  /**
   * Load document state from storage. Applies snapshot + log to `doc`.
   * Damaged log rows are quarantined; damaged snapshot returns ok:false.
   * SQL errors return ok:false with reason 'sql-error'.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Read snapshot chunks in order
      const chunks = this.storage.sql.exec<ChunkRow>(
        'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC',
      ).toArray();

      if (chunks.length > 0) {
        // Join and apply snapshot
        const sorted = chunks.sort((a, b) => a.idx - b.idx);
        let totalLen = 0;
        for (const c of sorted) totalLen += c.data.byteLength;
        const full = new Uint8Array(totalLen);
        let off = 0;
        for (const c of sorted) {
          const slice = new Uint8Array(c.data);
          full.set(slice, off);
          off += slice.length;
        }
        try {
          Y.applyUpdate(doc, full, LOAD_ORIGIN);
        } catch (_e: unknown) {
          const err = _e as Error;
          console.error({ msg: 'board-store.snapshot-unreadable', error: err.message });
          return { ok: false, reason: 'snapshot-unreadable', error: err.message };
        }
      }

      // Get snapshot-through seq
      const metaRows = this.storage.sql.exec<MetaRow>(
        "SELECT key, value FROM storage_meta WHERE key IN ('snapshot_through_seq','storage_schema_version')",
      ).toArray();

      let throughSeq = -1;
      for (const r of metaRows) {
        if (r.key === STORAGE_META_KEY_SNAPSHOT_THROUGH_SEQ) {
          throughSeq = parseInt(r.value, 10);
          break;
        }
      }

      // Apply log entries after snapshot
      const updates = this.storage.sql.exec<UpdateRow>(
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq ASC',
        [throughSeq],
      ).toArray();

      let quarantined = 0;

      for (const row of updates) {
        const updateData = new Uint8Array(row.data);
        try {
          Y.applyUpdate(doc, updateData, LOAD_ORIGIN);
        } catch (_e: unknown) {
          const err = _e as Error;
          // Quarantine damaged row inside a transaction
          try {
            this.storage.transactionSync(() => {
              this.storage.sql.exec(
                'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
                [row.seq, row.data, err.message, Date.now()],
              );
              this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', [row.seq]);
            });
            quarantined++;
            console.error({ msg: 'board-store.quarantined-update', seq: row.seq, error: err.message });
          } catch (qErr) {
            console.error({ msg: 'board-store.quarantine-failed', seq: row.seq, error: qErr });
          }
          continue;
        }
      }

      // Reset in-memory counters
      this._updateCount = 0;
      this._updateBytes = 0;

      return { ok: true, quarantined };
    } catch (_e: unknown) {
      const err = _e as Error;
      console.error({ msg: 'board-store.sql-error-load', error: err.message });
      return { ok: false, reason: 'sql-error', error: err.message };
    }
  }

  /**
   * Compact the update log into a snapshot. Never throws; returns false on no-op or rollback.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    try {
      if (!shouldCompact(this._updateCount, this._updateBytes)) {
        return false;
      }

      // Encode entire doc state
      const stateAsUpdate = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(stateAsUpdate);

      // Find max seq to know what to delete from updates
      const maxSeqRows = this.storage.sql.exec<{ mx: number | null }>(
        'SELECT MAX(seq) AS mx FROM updates',
      ).toArray();
      const maxSeq = maxSeqRows.length > 0 && maxSeqRows[0].mx !== null ? maxSeqRows[0].mx! : 0;

      // Single transaction: replace snapshot, truncate log
      try {
        this.storage.transactionSync(() => {
          // Delete old snapshot chunks
          this.storage.sql.exec('DELETE FROM snapshot_chunks');
          // Insert new chunks
          for (let i = 0; i < chunks.length; i++) {
            this.storage.sql.exec(
              'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
              [i, chunks[i].buffer.slice(chunks[i].byteOffset, chunks[i].byteOffset + chunks[i].byteLength)],
            );
          }
          // Delete updated log rows
          if (maxSeq > 0) {
            this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', [maxSeq]);
          }
          // Update through_seq
          const existingThrough = this.storage.sql.exec<MetaRow>(
            "SELECT value FROM storage_meta WHERE key = ?",
            [STORAGE_META_KEY_SNAPSHOT_THROUGH_SEQ],
          ).toArray();
          if (existingThrough.length > 0) {
            this.storage.sql.exec(
              'UPDATE storage_meta SET value = ? WHERE key = ?',
              [String(maxSeq), STORAGE_META_KEY_SNAPSHOT_THROUGH_SEQ],
            );
          } else {
            this.storage.sql.exec(
              'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
              [STORAGE_META_KEY_SNAPSHOT_THROUGH_SEQ, String(maxSeq)],
            );
          }
        });
      } catch (_e: unknown) {
        console.error({ msg: 'board-store.compaction-rollback', error: _e });
        return false;
      }

      // Reset counters since log is now empty
      this._updateCount = 0;
      this._updateBytes = 0;

      return true;
    } catch (_e: unknown) {
      console.error({ msg: 'board-store.compaction-error', error: _e });
      return false;
    }
  }

  get updateCount(): number {
    return this._updateCount;
  }

  get updateBytes(): number {
    return this._updateBytes;
  }
}
