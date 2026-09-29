import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, i + size));
  }
  return chunks;
}

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

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

interface SqlCursor {
  toArray(): any[];
  next(): { done: boolean; value?: any };
  rowsRead: number;
  rowsWritten: number;
}

interface DurableObjectStorage {
  sql: {
    exec(query: string, ...params: any[]): SqlCursor;
  };
  transactionSync(fn: () => void): void;
}

function toBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.length);
  new Uint8Array(buf).set(data);
  return buf;
}

/** Ensure data is a proper standalone Uint8Array for Yjs operations. */
function toUint8(data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    return copy;
  }
  if (data instanceof ArrayBuffer) {
    const view = new Uint8Array(data);
    const copy = new Uint8Array(view.length);
    copy.set(view);
    return copy;
  }
  return new Uint8Array(data);
}

/** Execute a query and return the first row, or null if no rows. */
function sqlOne(sql: DurableObjectStorage['sql'], query: string, ...params: any[]): any {
  const result = sql.exec(query, ...params).next();
  return result.done ? null : result.value;
}

export class BoardStore {
  private storage: DurableObjectStorage;
  private rowCount = 0;
  private byteTotal = 0;
  private migrated = false;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /**
   * Read-only existence check (share.board_api).
   *
   * A board exists if `storage_meta.created_at` is set, **or** (legacy,
   * share.legacy_boards) it has at least one row in `updates` or
   * `snapshot_chunks`. This only reads: it queries `sqlite_master` first and
   * never creates tables, so probing an unknown link leaves no storage behind.
   */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    const tables = new Set(
      sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((row: any) => row.name),
    );

    if (tables.has('storage_meta')) {
      const row = sqlOne(sql, "SELECT value FROM storage_meta WHERE key = 'created_at'");
      if (row) return true;
    }
    if (tables.has('updates')) {
      const row = sqlOne(sql, 'SELECT COUNT(*) as cnt FROM updates');
      if (row && row.cnt > 0) return true;
    }
    if (tables.has('snapshot_chunks')) {
      const row = sqlOne(sql, 'SELECT COUNT(*) as cnt FROM snapshot_chunks');
      if (row && row.cnt > 0) return true;
    }
    return false;
  }

  migrate(): void {
    const sql = this.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');

    // Set schema version if absent
    const existing = sqlOne(sql, 'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version');
    if (!existing) {
      sql.exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', 'storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }

    // Track current row count and byte total
    const countRow = sqlOne(sql, 'SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates');
    this.rowCount = countRow ? countRow.cnt : 0;
    this.byteTotal = countRow ? countRow.total : 0;

    this.migrated = true;
  }

  append(update: Uint8Array): void {
    // migrate() no longer runs on construct; run it lazily before the first
    // append (legacy boards already have tables, so this is a no-op for them).
    if (!this.migrated) {
      this.migrate();
    }
    const sql = this.storage.sql;
    sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toBuffer(update), update.length);
    this.rowCount++;
    this.byteTotal += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    const sql = this.storage.sql;

    try {
      // Missing tables mean an empty board (a board that was never
      // initialized and never had data). Treat as empty without creating
      // tables, so read paths never write storage.
      const tables = new Set(
        sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((row: any) => row.name),
      );
      if (!tables.has('snapshot_chunks') && !tables.has('updates')) {
        return { ok: true, quarantined: 0 };
      }

      // Load snapshot (table may be absent on legacy boards)
      const chunkRows = tables.has('snapshot_chunks')
        ? sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx').toArray()
        : [];
      const chunks: Uint8Array[] = chunkRows.map((row: any) => row.data as Uint8Array);

      if (chunks.length > 0) {
        const safeChunks = chunks.map(c => toUint8(c));
        const snapshotBytes = joinChunks(safeChunks);
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

      // Get snapshot_through_seq (table may be absent on legacy boards)
      const throughRow = tables.has('storage_meta')
        ? sqlOne(sql, "SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        : null;
      const throughSeq = throughRow ? parseInt(throughRow.value, 10) : 0;

      // Load and apply log rows after throughSeq (table may be absent)
      let quarantined = 0;
      const updateRows = tables.has('updates')
        ? sql.exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq).toArray()
        : [];

      for (const row of updateRows) {
        const seq = row.seq;
        const data = toUint8(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          // Quarantine this row
          const error = e instanceof Error ? e.message : String(e);
          this.storage.transactionSync(() => {
            sql.exec('INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              seq, toBuffer(data), error, Date.now());
            sql.exec('DELETE FROM updates WHERE seq = ?', seq);
          });
          quarantined++;
          this.rowCount--;
          this.byteTotal -= data.length;
          console.error(JSON.stringify({
            event: 'quarantine',
            seq,
            error,
          }));
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
    if (!shouldCompact(this.rowCount, this.byteTotal)) {
      return false;
    }

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);

      if (chunks.length === 0) {
        return false;
      }

      const sql = this.storage.sql;

      // Get the max seq from the updates table
      const maxSeqRow = sqlOne(sql, 'SELECT MAX(seq) as max_seq FROM updates');
      const maxSeq = maxSeqRow ? (maxSeqRow.max_seq || 0) : 0;

      this.storage.transactionSync(() => {
        // Delete old snapshot chunks
        sql.exec('DELETE FROM snapshot_chunks');

        // Insert new chunks
        for (let i = 0; i < chunks.length; i++) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, toBuffer(chunks[i]));
        }

        // Delete updates that are now in the snapshot
        if (maxSeq > 0) {
          sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }

        // Update snapshot_through_seq
        sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          'snapshot_through_seq', String(maxSeq));
      });

      // Reset in-memory counters
      this.rowCount = 0;
      this.byteTotal = 0;

      return true;
    } catch (e) {
      console.error(JSON.stringify({
        event: 'compaction-failed',
        error: e instanceof Error ? e.message : String(e),
      }));
      return false;
    }
  }
}
