import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import { chunkBytes, joinChunks, shouldCompact } from './chunking';

export { chunkBytes, joinChunks, shouldCompact };

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Origin for updates applied while loading: neither stored nor broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

const toBytes = (v: unknown): Uint8Array => new Uint8Array(v as ArrayBuffer);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class BoardStore {
  private rowCount = 0;
  private rowBytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql() {
    return this.storage.sql;
  }

  migrate(): void {
    const sql = this.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
    sql.exec(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      'storage_schema_version', String(STORAGE_SCHEMA_VERSION),
    );
  }

  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.rowCount += 1;
    this.rowBytes += update.length;
  }

  private throughSeq(): number {
    const row = this.sql.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'").toArray()[0];
    return row ? Number(row.value) : 0;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      const chunks = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx').toArray()
        .map((r) => toBytes(r.data));
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (e) {
          console.error(JSON.stringify({ event: 'snapshot-unreadable', error: message(e) }));
          return { ok: false, reason: 'snapshot-unreadable', error: message(e) };
        }
      }
      const rows = this.sql.exec(
        'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', this.throughSeq(),
      ).toArray();
      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytes += data.length;
        } catch (e) {
          const seq = row.seq as number;
          const error = message(e);
          console.error(JSON.stringify({ event: 'update-quarantined', seq, error }));
          this.storage.transactionSync(() => {
            this.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              seq, data, error, Date.now(),
            );
            this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
          });
          quarantined += 1;
        }
      }
      this.rowCount = count;
      this.rowBytes = bytes;
      return { ok: true, quarantined };
    } catch (e) {
      console.error(JSON.stringify({ event: 'load-sql-error', error: message(e) }));
      return { ok: false, reason: 'sql-error', error: message(e) };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    return shouldCompact(this.rowCount, this.rowBytes) && this.compactNow(doc);
  }

  /** Compacts regardless of thresholds (also used by the test hooks); never throws. */
  compactNow(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const maxSeq = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m);
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, c));
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          'snapshot_through_seq', String(maxSeq),
        );
      });
      this.rowCount = 0;
      this.rowBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: message(e) }));
      return false;
    }
  }
}
