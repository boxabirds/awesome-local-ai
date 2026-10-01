import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export const LOAD_ORIGIN: unique symbol = Symbol('load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));
  return chunks;
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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toBytes = (v: unknown) => new Uint8Array(v as ArrayBuffer);

export class BoardStore {
  private count = 0;
  private bytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql() {
    return this.storage.sql;
  }

  migrate(): void {
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
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      'storage_schema_version',
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update.slice(), update.length);
    this.count += 1;
    this.bytes += update.length;
  }

  private throughSeq(): number {
    const rows = this.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").toArray();
    return rows.length ? Number(rows[0].value) : 0;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      const chunks = this.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((r) => toBytes(r.data));
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: errorText(e) };
        }
      }
      const rows = this.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', this.throughSeq())
        .toArray();
      let quarantined = 0;
      this.count = 0;
      this.bytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          this.count += 1;
          this.bytes += data.length;
        } catch (e) {
          const error = errorText(e);
          console.error(JSON.stringify({ event: 'update-quarantined', seq: row.seq, error }));
          this.storage.transactionSync(() => {
            this.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              data.slice(),
              error,
              Date.now(),
            );
            this.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
          });
          quarantined += 1;
        }
      }
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorText(e) };
    }
  }

  /** Never throws. `force` compacts regardless of thresholds (test hooks). */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.count, this.bytes)) return false;
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const max = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m);
        const through = Math.max(max, this.throughSeq());
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, c));
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', max);
        this.sql.exec(
          "INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)",
          String(through),
        );
      });
      this.count = 0;
      this.bytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: errorText(e) }));
      return false;
    }
  }
}
