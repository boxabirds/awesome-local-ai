import * as Y from 'yjs';
import {
  COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES, STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export const LOAD_ORIGIN: unique symbol = Symbol('load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += size) out.push(data.slice(at, at + size));
  return out;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** The slice of DurableObjectStorage the store uses (structural, so the module also typechecks outside the worker project). */
export interface StorageLike {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>>; one(): Record<string, unknown> } };
  transactionSync<R>(fn: () => R): R;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toBytes = (v: unknown) => new Uint8Array(v as ArrayBuffer);

export class BoardStore {
  private count = 0;
  private bytes = 0;

  constructor(private readonly storage: StorageLike) {}

  private get sql() { return this.storage.sql; }

  migrate(): void {
    const { sql } = this;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
    sql.exec(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      'storage_schema_version', String(STORAGE_SCHEMA_VERSION),
    );
    this.refreshTotals();
  }

  private refreshTotals(): void {
    const row = this.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM updates').one();
    this.count = Number(row.n);
    this.bytes = Number(row.b);
  }

  private meta(key: string): string | null {
    const rows = this.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    return rows.length ? String(rows[0].value) : null;
  }

  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.count += 1;
    this.bytes += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    let chunks: Uint8Array[];
    let throughSeq: number;
    try {
      chunks = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx').toArray().map((r) => toBytes(r.data));
      throughSeq = Number(this.meta('snapshot_through_seq') ?? 0);
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: message(e) };
    }
    if (chunks.length > 0) {
      try {
        Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
      } catch (e) {
        return { ok: false, reason: 'snapshot-unreadable', error: message(e) };
      }
    }
    try {
      const rows = this.sql.exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq).toArray();
      let quarantined = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          this.quarantine(Number(row.seq), data, message(e));
          quarantined += 1;
        }
      }
      this.refreshTotals();
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: message(e) };
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    console.error(JSON.stringify({ event: 'update-quarantined', seq, error }));
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq, data, error, Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  /** Never throws; returns false on no-op or after a rolled-back failure. `force` skips the threshold check. */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.count, this.bytes)) return false;
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const max = this.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m;
        const maxSeq = max === null ? Number(this.meta('snapshot_through_seq') ?? 0) : Number(max);
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, c));
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', 'snapshot_through_seq', String(maxSeq),
        );
      });
      this.refreshTotals();
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: message(e) }));
      try { this.refreshTotals(); } catch { /* keep previous totals */ }
      return false;
    }
  }
}
