// Board persistence inside a Durable Object's SQLite storage. One database per
// board. Tables are created only by `migrate()` (run from BoardRoom.initialize()
// or lazily before the first `append()`); existence checks and loads never
// write, so probing an unknown link leaves no storage behind (PRD
// share.not_found / share.legacy_boards).

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Split `data` into at most `size`-byte chunks (0 bytes -> 0 chunks). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class BoardStore {
  private readonly storage: DurableObjectStorage;
  /** log rows applied since the snapshot, and their byte total (tracked in memory) */
  private logCount = 0;
  private logBytes = 0;
  private tablesReady = false;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /** CREATE TABLE IF NOT EXISTS; writes no update rows. */
  migrate(): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec(
        `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, bytes INTEGER NOT NULL)`,
      );
      sql.exec(`CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data TEXT NOT NULL)`);
      sql.exec(
        `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data TEXT NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
      );
      const rows = sql
        .exec(`SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`)
        .toArray();
      if (rows.length === 0) {
        sql.exec(
          `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?1)`,
          String(STORAGE_SCHEMA_VERSION),
        );
      }
    });
    this.tablesReady = true;
  }

  private ensureMigrated(): void {
    if (!this.tablesReady) this.migrate();
  }

  /**
   * Read-only existence check. False for boards with no tables and for boards
   * that have tables but neither a created_at marker nor any content rows.
   * Never creates tables (queries sqlite_master first).
   */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    const tables = sql
      .exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('storage_meta', 'updates', 'snapshot_chunks')`,
      )
      .toArray();
    if (tables.length === 0) return false;
    const names = new Set(tables.map((r) => String(r.name)));
    if (names.has('storage_meta')) {
      const created = sql
        .exec(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
        .toArray();
      if (created.length > 0) return true;
    }
    if (names.has('updates') && sql.exec(`SELECT seq FROM updates LIMIT 1`).toArray().length > 0) {
      return true; // legacy board: content but no created_at (PRD share.legacy_boards)
    }
    if (
      names.has('snapshot_chunks') &&
      sql.exec(`SELECT idx FROM snapshot_chunks LIMIT 1`).toArray().length > 0
    ) {
      return true; // legacy board with a snapshot
    }
    return false;
  }

  /** Names of the board's tables (test observation of "no storage written"). */
  listTables(): string[] {
    return this.storage.sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .toArray()
      .map((row) => String(row['name']));
  }

  /** Epoch ms written when the board was created, or null. Read-only. */
  createdAt(): number | null {
    const tables = this.storage.sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_meta'`)
      .toArray();
    if (tables.length === 0) return null;
    const rows = this.storage.sql
      .exec(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
      .toArray();
    if (rows.length === 0) return null;
    const n = Number(rows[0]!['value']);
    return Number.isFinite(n) ? n : null;
  }

  /** Set created_at when absent; false when it already existed (collision). */
  markCreatedAtIfAbsent(now: number): boolean {
    this.ensureMigrated();
    let created = false;
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const existing = sql.exec(`SELECT value FROM storage_meta WHERE key = 'created_at'`).toArray();
      if (existing.length === 0) {
        sql.exec(`INSERT INTO storage_meta (key, value) VALUES ('created_at', ?1)`, String(now));
        created = true;
      }
    });
    return created;
  }

  /** Append one Yjs update to the log. Throws on SQL failure (caller resets the room). */
  append(update: Uint8Array): void {
    this.ensureMigrated();
    const bytes = update.length;
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        `INSERT INTO updates (data, bytes) VALUES (?1, ?2)`,
        toBase64(update),
        bytes,
      );
    });
    this.logCount += 1;
    this.logBytes += bytes;
  }

  /** Seed raw updates without a created_at marker (test-only legacy fixtures). */
  seedLegacyUpdates(updates: readonly Uint8Array[]): void {
    this.migrate();
    this.storage.transactionSync(() => {
      for (const u of updates) {
        this.storage.sql.exec(
          `INSERT INTO updates (data, bytes) VALUES (?1, ?2)`,
          toBase64(u),
          u.length,
        );
      }
    });
  }

  /**
   * Load snapshot + log into `doc`. Missing tables mean an empty board; no
   * tables are created here. Damaged log rows are quarantined; a damaged
   * snapshot is fatal.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const sql = this.storage.sql;
      const tables = sql
        .exec(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('storage_meta', 'updates', 'snapshot_chunks')`,
        )
        .toArray();
      if (tables.length === 0) {
        // Empty board: do not create anything (share.not_found must not write).
        this.tablesReady = false;
        this.logCount = 0;
        this.logBytes = 0;
        return { ok: true, quarantined: 0 };
      }
      this.tablesReady = true;

      let throughSeq = 0;
      const metaNames = new Set(tables.map((r) => String(r.name)));
      if (metaNames.has('storage_meta')) {
        const through = sql
          .exec(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`)
          .toArray();
        if (through.length > 0) throughSeq = Number(through[0]!['value']) || 0;
      }

      if (metaNames.has('snapshot_chunks') && throughSeq > 0) {
        const chunks = sql
          .exec(`SELECT data FROM snapshot_chunks ORDER BY idx ASC`)
          .toArray();
        if (chunks.length > 0) {
          const bytes = joinChunks(chunks.map((c) => fromBase64(String(c.data))));
          try {
            Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
          } catch (e) {
            return {
              ok: false,
              reason: 'snapshot-unreadable',
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }
      }

      const rows = sql
        .exec(`SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq ASC`, throughSeq)
        .toArray();
      let quarantined = 0;
      let count = 0;
      let bytesTotal = 0;
      for (const row of rows) {
        const seq = Number(row['seq']);
        const data = fromBase64(String(row['data']));
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytesTotal += Number(row['bytes']) || 0;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          this.storage.transactionSync(() => {
            sql.exec(
              `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)`,
              seq,
              String(row['data']),
              message,
              Date.now(),
            );
            sql.exec(`DELETE FROM updates WHERE seq = ?1`, seq);
          });
          quarantined += 1;
          console.error(JSON.stringify({ event: 'update-quarantined', seq, error: message }));
        }
      }
      this.logCount = count;
      this.logBytes = bytesTotal;
      return { ok: true, quarantined };
    } catch (e) {
      return {
        ok: false,
        reason: 'sql-error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Compact the log into a snapshot when thresholds are reached. Never throws;
   * returns false on no-op or after a rolled-back failure (log stays intact).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    const encoded = Y.encodeStateAsUpdate(doc);
    const maxSeqRow = this.storage.sql
      .exec(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM updates`)
      .toArray()[0];
    const maxSeq = Number(maxSeqRow?.['max_seq'] ?? 0);
    const chunks = chunkBytes(encoded);
    try {
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec(`DELETE FROM snapshot_chunks`);
        chunks.forEach((chunk, idx) => {
          sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, idx, toBase64(chunk));
        });
        if (maxSeq > 0) sql.exec(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
        const has = sql
          .exec(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`)
          .toArray();
        if (has.length === 0) {
          sql.exec(
            `INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?1)`,
            String(maxSeq),
          );
        } else {
          sql.exec(
            `UPDATE storage_meta SET value = ?1 WHERE key = 'snapshot_through_seq'`,
            String(maxSeq),
          );
        }
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failed', error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }
}
