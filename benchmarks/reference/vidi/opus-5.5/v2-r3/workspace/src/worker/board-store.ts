// BoardStore: a board's saved state in its Durable Object's SQLite database.
//
//   storage_meta         key/value: storage_schema_version, snapshot_through_seq
//   updates              append-only log of Yjs updates applied since the snapshot
//   snapshot_chunks      the compacted board (Y.encodeStateAsUpdate), split into rows
//   quarantined_updates  log rows that could not be read on load (kept, never replayed)
//
// Every applied update is appended as it happens (persist.automatic), so the board
// survives everyone leaving and restarts (persist.reopen, persist.restart).
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin for updates replayed from storage: never stored again or broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Splits `data` into consecutive chunks of at most `size` bytes (none for empty data). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!(size > 0)) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < data.byteLength; at += size) chunks.push(data.slice(at, at + size));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** True once the log holds COMPACTION_UPDATE_COUNT rows or COMPACTION_BYTES bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** SQLite binds BLOBs from ArrayBuffers; copy so a view's surrounding bytes are never stored. */
function blob(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('expected a BLOB');
}

/**
 * Applies an update, decoding it fully first so malformed bytes are rejected
 * before anything is integrated into `doc`.
 */
function applyStored(doc: Y.Doc, update: Uint8Array): void {
  Y.decodeUpdate(update);
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

/**
 * After a log row was quarantined, later updates from the same Yjs client refer
 * to clock ranges that no longer exist and would stay pending forever. Each such
 * gap is filled with a GC (deleted) placeholder so everything after the damaged
 * change still loads; only the damaged change itself is missing.
 */
function fillQuarantineGaps(doc: Y.Doc): void {
  for (let pass = 0; pass < 8 && doc.store.pendingStructs !== null; pass++) {
    const firstPending = new Map<number, number>();
    for (const struct of Y.decodeUpdateV2(doc.store.pendingStructs.update).structs) {
      const { client, clock } = struct.id;
      firstPending.set(client, Math.min(clock, firstPending.get(client) ?? Infinity));
    }
    const gaps = [...firstPending]
      .map(([client, clock]) => ({ client, clock: Y.getState(doc.store, client), len: clock - Y.getState(doc.store, client) }))
      .filter((g) => g.len > 0);
    if (gaps.length === 0) return;
    // Update v1: per client one GC struct (info 0) covering the gap; empty delete set.
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, gaps.length);
    for (const g of gaps) {
      encoding.writeVarUint(e, 1);
      encoding.writeVarUint(e, g.client);
      encoding.writeVarUint(e, g.clock);
      encoding.writeUint8(e, 0);
      encoding.writeVarUint(e, g.len);
    }
    encoding.writeVarUint(e, 0);
    Y.applyUpdate(doc, encoding.toUint8Array(e), LOAD_ORIGIN);
  }
}

export interface BoardStoreOptions {
  /** Snapshot chunk size (tests only; defaults to SNAPSHOT_CHUNK_BYTES). */
  chunkBytes?: number;
}

export class BoardStore {
  private readonly sql: SqlStorage;
  private readonly chunkSize: number;
  /** Log rows and bytes, tracked in memory after load (no COUNT(*) per write). */
  private logCount = 0;
  private logBytes = 0;

  constructor(
    private readonly storage: DurableObjectStorage,
    options: BoardStoreOptions = {},
  ) {
    this.sql = storage.sql;
    this.chunkSize = options.chunkBytes ?? SNAPSHOT_CHUNK_BYTES;
  }

  /** Creates the tables. Writes no update or snapshot rows (a never-edited board stays empty). */
  migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Appends one update to the log. Throws on SQL failure (the room then resets). */
  append(update: Uint8Array): void {
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', blob(update), update.byteLength);
    this.logCount++;
    this.logBytes += update.byteLength;
  }

  /**
   * Loads the snapshot, then every log row after it, into `doc`. An unreadable
   * snapshot fails the whole load (nothing is deleted); an unreadable log row is
   * moved to quarantined_updates and the rest still load (persist.partial_damage).
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const chunks = this.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((r) => bytesOf(r.data));
      if (chunks.length > 0) {
        try {
          applyStored(doc, joinChunks(chunks));
          // A full-state snapshot never depends on missing content; if it does, it is damaged.
          if (doc.store.pendingStructs !== null) throw new Error('snapshot has unresolved references');
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: errorText(e) };
        }
      }
      const rows = this.sql
        .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
          'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
          this.throughSeq(),
        )
        .toArray();
      let quarantined = 0;
      this.logCount = 0;
      this.logBytes = 0;
      for (const row of rows) {
        const data = bytesOf(row.data);
        try {
          applyStored(doc, data);
          this.logCount++;
          this.logBytes += row.bytes;
        } catch (e) {
          this.quarantine(row.seq, data, errorText(e));
          quarantined++;
        }
      }
      if (quarantined > 0) fillQuarantineGaps(doc);
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorText(e) };
    }
  }

  /** True when the log has reached a compaction threshold. */
  needsCompaction(): boolean {
    return shouldCompact(this.logCount, this.logBytes);
  }

  /** Compacts when the log reached a threshold. Never throws; false on no-op or rolled-back failure. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.needsCompaction()) return false;
    return this.compact(doc);
  }

  /**
   * Replaces the snapshot with `doc`'s full state and truncates the log it
   * covers, in one transaction: on any error the previous snapshot and log stay
   * intact. `doc` must already contain every logged update (the room's doc does).
   */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc), this.chunkSize);
      this.storage.transactionSync(() => {
        const max = this.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates').one().m;
        const through = max ?? this.throughSeq();
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, blob(c));
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.sql.exec(
          "INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          String(through),
        );
      });
      const rest = this.sql
        .exec<{ n: number; b: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM updates')
        .one();
      this.logCount = rest.n;
      this.logBytes = rest.b;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-store.compaction-failed', error: errorText(e) }));
      return false;
    }
  }

  private throughSeq(): number {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
      .toArray()[0];
    return row ? Number(row.value) : 0;
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        blob(data),
        error,
        Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board-store.update-quarantined', seq, error }));
  }
}
