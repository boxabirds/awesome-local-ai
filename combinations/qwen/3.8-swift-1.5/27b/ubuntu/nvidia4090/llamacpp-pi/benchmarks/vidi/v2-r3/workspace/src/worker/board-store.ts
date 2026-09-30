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
 * SqlStorage interface - the tagged template + transactionSync API.
 */
interface SqlStorage {
  (strings: TemplateStringsArray, ...values: unknown[]): { one(): any; all(): any[] };
  transactionSync(fn: () => void): void;
}

export class BoardStore {
  private sql: SqlStorage;
  private rowCount = 0;
  private byteTotal = 0;

  constructor(storage: { sql: SqlStorage; transactionSync?: (fn: () => void) => void }) {
    this.sql = storage.sql;
  }

  migrate(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `;
    const row = this.sql`SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`.one();
    if (row === undefined) {
      this.sql`INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', '1')`;
    }
  }

  append(update: Uint8Array): void {
    this.sql`INSERT INTO updates (data, bytes) VALUES (${update}, ${update.length})`;
    this.rowCount++;
    this.byteTotal += update.length;
  }

  load(doc: Y.Doc): LoadResult {
    try {
      // Load snapshot
      const snapshotRows = this.sql`SELECT data FROM snapshot_chunks ORDER BY idx`.all();
      if (snapshotRows.length > 0) {
        const chunks = snapshotRows.map((r: any) => r.data as Uint8Array);
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, reason: 'snapshot-unreadable', error: msg };
        }
      }

      // Get through_seq
      const throughRow = this.sql`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`.one();
      const throughSeq = throughRow ? parseInt(throughRow.value, 10) : 0;

      // Load updates after through_seq
      const updateRows = this.sql`SELECT seq, data FROM updates WHERE seq > ${throughSeq} ORDER BY seq`.all();
      let quarantined = 0;
      for (const row of updateRows) {
        try {
          Y.applyUpdate(doc, row.data as Uint8Array, LOAD_ORIGIN);
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          this.sql.transactionSync(() => {
            this.sql`INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (${row.seq}, ${row.data}, ${errorText}, ${Date.now()})`;
            this.sql`DELETE FROM updates WHERE seq = ${row.seq}`;
          });
          quarantined++;
          console.error('quarantined_update', { seq: row.seq, error: errorText });
        }
      }

      // Track in-memory counts
      const remaining = this.sql`SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates`.one();
      this.rowCount = remaining ? (remaining.cnt as number) : 0;
      this.byteTotal = remaining ? (remaining.total as number) : 0;

      return { ok: true, quarantined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: 'sql-error', error: msg };
    }
  }

  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxSeqRow = this.sql`SELECT COALESCE(MAX(seq), 0) as max_seq FROM updates`.one();
      const maxSeq = maxSeqRow ? (maxSeqRow.max_seq as number) : 0;

      this.sql.transactionSync(() => {
        this.sql`DELETE FROM snapshot_chunks`;
        for (let i = 0; i < chunks.length; i++) {
          this.sql`INSERT INTO snapshot_chunks (idx, data) VALUES (${i}, ${chunks[i]})`;
        }
        this.sql`DELETE FROM updates WHERE seq <= ${maxSeq}`;
        this.sql`INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ${String(maxSeq)})`;
      });

      this.rowCount = 0;
      this.byteTotal = 0;
      return true;
    } catch (err) {
      console.error('compaction_failed', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}
