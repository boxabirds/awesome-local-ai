import * as Y from 'yjs';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../shared/config';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load-origin');

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, Math.min(i + size, data.length)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * SqlStorage — the exec-based SQL API exposed as `ctx.storage.sql` on the
 * current platform (workerd 1.2026+). Statements use `?` placeholders and
 * return a cursor with `one()` / `toArray()`.
 */
interface SqlCursor {
  one(): any;
  toArray(): any[];
}
interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}

/**
 * In-memory tables with the same semantics as the SQLite schema. Used only in
 * test environments where the Durable Object has no SQLite storage
 * (vitest-pool-workers does not enable `ctx.storage.sql`); production always
 * uses SQL.
 */
interface MemTables {
  meta: Map<string, string>;
  updates: { seq: number; data: Uint8Array }[];
  nextSeq: number;
  snapshotChunks: Map<number, Uint8Array>;
}

/** Copy a Uint8Array into its own ArrayBuffer (binding-safe). */
function toBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

/**
 * First row of a query, or undefined when there are none. The exec cursor's
 * `one()` throws on zero rows, so go through `toArray()`.
 */
function oneRow(cursor: SqlCursor): any {
  const rows = cursor.toArray();
  return rows.length === 0 ? undefined : rows[0];
}

export class BoardStore {
  private sql: SqlStorage | undefined;
  private transactionSync: ((fn: () => void) => void) | undefined;
  private mem: MemTables | undefined;
  private rowCount = 0;
  private byteTotal = 0;
  private migrated = false;

  constructor(storage: { sql?: SqlStorage; transactionSync?: (fn: () => void) => void }) {
    if (storage.sql) {
      this.sql = storage.sql;
      this.transactionSync = storage.transactionSync;
    } else {
      this.mem = { meta: new Map(), updates: [], nextSeq: 1, snapshotChunks: new Map() };
    }
  }

  /** True when the real SQLite storage backend is in use. */
  get hasSql(): boolean {
    return this.sql !== undefined;
  }

  /** SQLite backend (only valid when hasSql is true). */
  private get db(): SqlStorage {
    return this.sql!;
  }

  migrate(): void {
    if (this.migrated) return;
    this.migrated = true;
    if (this.mem) {
      this.mem.meta.set('storage_schema_version', '1');
      return;
    }
    const sql = this.sql!;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
    const row = oneRow(sql.exec("SELECT value FROM storage_meta WHERE key = ?", 'storage_schema_version'));
    if (row === undefined) {
      sql.exec("INSERT INTO storage_meta (key, value) VALUES (?, ?)", 'storage_schema_version', '1');
    }
  }

  /**
   * Read-only existence check (share.legacy_boards): a board exists if its
   * storage has `storage_meta.created_at`, or (legacy) at least one row in
   * `updates` or `snapshot_chunks`. Queries sqlite_master first; never
   * creates tables, so probing an unknown link writes nothing.
   */
  existsReadOnly(): boolean {
    if (this.mem) {
      return (
        this.mem.meta.has('created_at') ||
        this.mem.updates.length > 0 ||
        this.mem.snapshotChunks.size > 0
      );
    }
    try {
      const sql = this.sql!;
      const tables = this.existingTables();
      if (tables.has('storage_meta')) {
        const row = oneRow(sql.exec("SELECT value FROM storage_meta WHERE key = ?", 'created_at'));
        if (row !== undefined) return true;
      }
      if (tables.has('updates')) {
        const row = oneRow(sql.exec('SELECT COUNT(*) AS cnt FROM updates'));
        if (row && (row.cnt as number) > 0) return true;
      }
      if (tables.has('snapshot_chunks')) {
        const row = oneRow(sql.exec('SELECT COUNT(*) AS cnt FROM snapshot_chunks'));
        if (row && (row.cnt as number) > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getCreatedAt(): number | null {
    if (this.mem) {
      const v = this.mem.meta.get('created_at');
      return v === undefined ? null : parseInt(v, 10);
    }
    try {
      const row = oneRow(this.db.exec("SELECT value FROM storage_meta WHERE key = ?", 'created_at'));
      return row === undefined ? null : parseInt(row.value, 10);
    } catch {
      return null;
    }
  }

  setCreatedAt(epochMs: number): void {
    if (this.mem) {
      this.mem.meta.set('created_at', String(epochMs));
      return;
    }
    this.db.exec("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)", 'created_at', String(epochMs));
  }

  /** Read a raw storage_meta value (test hooks). */
  getMeta(key: string): string | null {
    if (this.mem) {
      const v = this.mem.meta.get(key);
      return v === undefined ? null : v;
    }
    const row = oneRow(this.db.exec('SELECT value FROM storage_meta WHERE key = ?', key));
    return row === undefined ? null : row.value;
  }

  /** Write a raw storage_meta value (test hooks). */
  setMeta(key: string, value: string): void {
    if (this.mem) {
      this.mem.meta.set(key, value);
      return;
    }
    this.db.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', key, value);
  }

  /** Read one snapshot chunk (test hooks). */
  readSnapshotChunk(idx: number): Uint8Array | null {
    if (this.mem) {
      const d = this.mem.snapshotChunks.get(idx);
      return d === undefined ? null : d;
    }
    const row = oneRow(this.db.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', idx));
    if (row === undefined || row.data === undefined) return null;
    return new Uint8Array(row.data as ArrayBuffer);
  }

  /** Write (replace) one snapshot chunk (test hooks). */
  writeSnapshotChunk(idx: number, data: Uint8Array): void {
    if (this.mem) {
      this.mem.snapshotChunks.set(idx, data);
      return;
    }
    this.db.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, toBuffer(data));
  }

  /** Delete one snapshot chunk (test hooks). */
  deleteSnapshotChunk(idx: number): void {
    if (this.mem) {
      this.mem.snapshotChunks.delete(idx);
      return;
    }
    this.db.exec('DELETE FROM snapshot_chunks WHERE idx = ?', idx);
  }

  append(update: Uint8Array): void {
    // Lazy migration: tables exist for initialized and legacy boards; this is
    // a no-op for them and creates them for the first append of a new board.
    this.migrate();
    if (this.mem) {
      this.mem.updates.push({ seq: this.mem.nextSeq++, data: update });
    } else {
      this.db.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toBuffer(update), update.length);
    }
    this.rowCount++;
    this.byteTotal += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    if (this.mem) return this.loadFromMemory(doc);
    try {
      // Treat missing tables as an empty board without creating them
      // (share.not_found: probing must write nothing).
      const tables = this.existingTables();
      if (!tables.has('updates') && !tables.has('snapshot_chunks')) {
        this.rowCount = 0;
        this.byteTotal = 0;
        return { ok: true, quarantined: 0 };
      }
      // Data present: ensure the full schema (quarantine writes need it).
      this.migrate();

      // Load snapshot
      const snapshotRows = this.db.exec('SELECT data FROM snapshot_chunks ORDER BY idx').toArray();
      if (snapshotRows.length > 0) {
        const chunks = snapshotRows.map((r: any) => new Uint8Array(r.data as ArrayBuffer));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, reason: 'snapshot-unreadable', error: msg };
        }
      }

      // Get through_seq
      const throughRow = oneRow(this.db.exec("SELECT value FROM storage_meta WHERE key = ?", 'snapshot_through_seq'));
      const throughSeq = throughRow ? parseInt(throughRow.value, 10) : 0;

      // Load updates after through_seq
      const updateRows = this.db.exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq).toArray();
      let quarantined = 0;
      for (const row of updateRows) {
        const data = new Uint8Array(row.data as ArrayBuffer);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          this.transactionSync!(() => {
            this.db.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              toBuffer(data),
              errorText,
              Date.now(),
            );
            this.db.exec('DELETE FROM updates WHERE seq = ?', row.seq);
          });
          quarantined++;
          console.error('quarantined_update', { seq: row.seq, error: errorText });
        }
      }

      // Track in-memory counts
      const remaining = oneRow(this.db.exec('SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates'));
      this.rowCount = remaining ? (remaining.cnt as number) : 0;
      this.byteTotal = remaining ? (remaining.total as number) : 0;

      return { ok: true, quarantined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: 'sql-error', error: msg };
    }
  }

  private loadFromMemory(doc: Y.Doc): LoadResult {
    try {
      const mem = this.mem!;
      if (mem.snapshotChunks.size > 0) {
        const chunks = [...mem.snapshotChunks.entries()]
          .sort((a, b) => a[0] - b[0])
          .filter(([idx]) => idx >= 0)
          .map(([, data]) => data);
        const snapshotBytes = joinChunks(chunks);
        if (snapshotBytes.length > 0) {
          try {
            Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
          } catch (err) {
            return { ok: false, reason: 'snapshot-unreadable', error: String(err) };
          }
        }
      }

      const throughSeq = parseInt(mem.meta.get('snapshot_through_seq') ?? '0', 10);
      let quarantined = 0;
      const kept: { seq: number; data: Uint8Array }[] = [];
      for (const row of mem.updates) {
        if (row.seq <= throughSeq) continue;
        try {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
          kept.push(row);
        } catch (err) {
          quarantined++;
          console.error('quarantined_update', { seq: row.seq, error: String(err) });
        }
      }
      mem.updates = kept;

      this.rowCount = kept.length;
      this.byteTotal = kept.reduce((sum, r) => sum + r.data.length, 0);
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  /**
   * Compaction gated on the size thresholds (called after every append).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;
    return this.compact(doc);
  }

  /**
   * Unconditional compaction: replace the log with a full-state snapshot.
   */
  compact(doc: Y.Doc): boolean {
    if (this.mem) {
      try {
        const encoded = Y.encodeStateAsUpdate(doc);
        const chunks = chunkBytes(encoded);
        this.mem.snapshotChunks = new Map(chunks.map((c, i) => [i, c]));
        this.mem.meta.set('snapshot_through_seq', String(this.mem.nextSeq - 1));
        this.mem.updates = [];
        this.rowCount = 0;
        this.byteTotal = 0;
        return true;
      } catch (err) {
        console.error('compaction_failed', { error: String(err) });
        return false;
      }
    }
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxSeqRow = oneRow(this.db.exec('SELECT COALESCE(MAX(seq), 0) as max_seq FROM updates'));
      const maxSeq = maxSeqRow ? (maxSeqRow.max_seq as number) : 0;

      this.transactionSync!(() => {
        this.db.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          this.db.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, toBuffer(chunks[i]));
        }
        this.db.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.db.exec("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)", 'snapshot_through_seq', String(maxSeq));
      });

      this.rowCount = 0;
      this.byteTotal = 0;
      return true;
    } catch (err) {
      console.error('compaction_failed', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private existingTables(): Set<string> {
    const rows = this.db.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray();
    return new Set((rows ?? []).map((r: any) => r.name as string));
  }
}
