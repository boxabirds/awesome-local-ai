import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin of updates applied while loading from storage; they are neither stored nor broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** The part of DurableObjectStorage the store uses (lets tests wrap it to inject failures). */
export interface StoreStorage {
  sql: { exec(query: string, ...bindings: any[]): { toArray(): Record<string, any>[] } };
  transactionSync<T>(fn: () => T): T;
}

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.subarray(i, Math.min(i + size, data.length)));
  return out;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

const toBytes = (v: unknown): Uint8Array => new Uint8Array(v as ArrayBuffer);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class BoardStore {
  private rows = 0;
  private bytes = 0;
  private migrated = false;

  constructor(private readonly storage: StoreStorage) {}

  private get sql() {
    return this.storage.sql;
  }

  private hasTable(name: string): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray().length > 0;
  }

  /** Read-only: false for a board that was never created (no tables exist, and none are created here). */
  existsReadOnly(): boolean {
    if (this.hasTable('storage_meta')) {
      if (this.sql.exec("SELECT 1 FROM storage_meta WHERE key = 'created_at'").toArray().length) return true;
    }
    // Legacy boards (from before explicit creation) are recognised by their saved content.
    for (const table of ['updates', 'snapshot_chunks']) {
      if (this.hasTable(table) && this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length) return true;
    }
    return false;
  }

  /** Creates the board: tables plus created_at, written once. */
  initialize(): 'created' | 'exists' {
    this.migrate();
    if (this.sql.exec("SELECT 1 FROM storage_meta WHERE key = 'created_at'").toArray().length) return 'exists';
    this.sql.exec("INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)", String(Date.now()));
    return 'created';
  }

  migrate(): void {
    this.migrated = true;
    const sql = this.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Throws on SQL failure; the caller resets the room. */
  append(update: Uint8Array): void {
    if (!this.migrated) this.migrate();
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.rows += 1;
    this.bytes += update.length;
  }

  private throughSeq(): number {
    const r = this.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").toArray();
    return r.length ? Number(r[0].value) : 0;
  }

  load(doc: Y.Doc): LoadResult {
    let quarantined = 0;
    try {
      // A board that was never created has no tables: it is empty, and loading must not create them.
      if (!this.hasTable('snapshot_chunks') || !this.hasTable('updates') || !this.hasTable('storage_meta')) {
        return { ok: true, quarantined };
      }
      const chunks = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx').toArray();
      if (chunks.length) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks.map((c) => toBytes(c.data))), LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: message(e) };
        }
      }
      const rows = this.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', this.throughSeq())
        .toArray();
      this.rows = 0;
      this.bytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          this.rows += 1;
          this.bytes += data.length;
        } catch (e) {
          const error = message(e);
          console.error(JSON.stringify({ event: 'update-quarantined', seq: row.seq, error }));
          this.storage.transactionSync(() => {
            this.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              data,
              error,
              Date.now(),
            );
            this.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
          });
          quarantined += 1;
        }
      }
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: message(e) };
    }
    return { ok: true, quarantined };
  }

  /** Never throws: returns false when nothing was done or the compaction was rolled back. */
  compactIfNeeded(doc: Y.Doc): boolean {
    return shouldCompact(this.rows, this.bytes) && this.compact(doc);
  }

  /** Replaces the snapshot with the doc's full state and truncates the log; false after a rollback. */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const max = this.sql.exec('SELECT MAX(seq) AS m FROM updates').toArray()[0]?.m;
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, c));
        if (max !== null && max !== undefined) {
          this.sql.exec('DELETE FROM updates WHERE seq <= ?', max);
          this.sql.exec(
            "INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)",
            String(max),
          );
        }
      });
      this.rows = 0;
      this.bytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: message(e) }));
      return false;
    }
  }
}
