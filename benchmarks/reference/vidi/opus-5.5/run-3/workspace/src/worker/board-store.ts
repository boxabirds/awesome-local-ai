// A board's saved state in its Durable Object's SQLite database: an append-only log of Yjs updates plus a
// chunked snapshot that compaction folds the log into.
//
//   storage_meta(key, value)                 storage_schema_version, snapshot_through_seq
//   updates(seq, data, bytes)                log rows newer than the snapshot
//   snapshot_chunks(idx, data)               Y.encodeStateAsUpdate split into SNAPSHOT_CHUNK_BYTES pieces
//   quarantined_updates(seq, data, error, quarantined_at)   log rows that could not be applied on load
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin of updates applied while loading from storage (never stored again, never broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * The part of `DurableObjectStorage` the store uses. Declared structurally so the pure helpers in this file
 * can also be imported outside the Workers runtime (unit tests); a real `DurableObjectStorage` satisfies it.
 */
export interface BoardStorage {
  sql: { exec(query: string, ...bindings: any[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(closure: () => T): T;
}

/** Splits `data` into pieces of at most `size` bytes (none for empty input). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!(size > 0)) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += size) chunks.push(data.subarray(at, Math.min(at + size, data.length)));
  return chunks;
}

/** Concatenates chunks back into one byte array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Whether a log of `count` rows totalling `bytes` should be compacted into the snapshot. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new TypeError(`expected a blob, got ${typeof v}`);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Applies `bytes` to `doc` with LOAD_ORIGIN. The update is decoded in full first, so malformed bytes throw
 * before anything reaches the document.
 */
function applyStored(doc: Y.Doc, bytes: Uint8Array): void {
  Y.decodeUpdate(bytes);
  Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
}

/** A v1 update holding one GC (garbage-collected placeholder) struct for `len` clocks of `client`. */
function gcUpdate(client: number, clock: number, len: number): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1); // one client
  encoding.writeVarUint(e, 1); // one struct
  encoding.writeVarUint(e, client);
  encoding.writeVarUint(e, clock);
  encoding.writeUint8(e, 0); // GC struct
  encoding.writeVarUint(e, len);
  encoding.writeVarUint(e, 0); // empty delete set
  return encoding.toUint8Array(e);
}

const MAX_GAP_FILL_ROUNDS = 1000;

/**
 * Yjs updates from one client form an unbroken clock sequence, so a quarantined log row would leave every
 * later change by the same client (and changes built on them) pending forever. Fills each gap with a GC
 * placeholder, as Yjs does for deleted content: later changes integrate, and only content that depended on
 * the lost change is dropped. Returns the number of gaps filled.
 */
function fillGaps(doc: Y.Doc): number {
  let filled = 0;
  for (let round = 0; round < MAX_GAP_FILL_ROUNDS && doc.store.pendingStructs; round++) {
    const pending = doc.store.pendingStructs;
    const structs = Y.decodeUpdateV2(pending.update).structs;
    let progress = false;
    for (const [client, missingClock] of pending.missing) {
      const state = Y.getState(doc.store, client);
      let next = Infinity;
      for (const s of structs) if (s.id.client === client && s.id.clock >= state) next = Math.min(next, s.id.clock);
      const end = next !== Infinity && next > state ? next : missingClock + 1;
      if (end <= state) continue;
      Y.applyUpdate(doc, gcUpdate(client, state, end - state), LOAD_ORIGIN);
      console.error(JSON.stringify({ event: 'board_gap_filled', client, clock: state, len: end - state }));
      filled += 1;
      progress = true;
      break; // the pending set changed; recompute
    }
    if (!progress) break;
  }
  return filled;
}

export class BoardStore {
  private readonly storage: BoardStorage;
  /** Log rows (and their total bytes) newer than the snapshot; tracked in memory after `load`. */
  private logCount = 0;
  private logBytes = 0;

  constructor(storage: BoardStorage) {
    this.storage = storage;
  }

  private exec(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    return this.storage.sql.exec(query, ...bindings).toArray();
  }

  /** Creates the tables if needed and records the storage schema version. Writes no board content. */
  migrate(): void {
    this.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    this.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Appends one update to the log. Throws if the row cannot be written (the caller resets the room). */
  append(update: Uint8Array): void {
    this.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  /**
   * Loads the snapshot and then every newer log row into `doc`. An unreadable snapshot fails the load and
   * changes nothing in storage; an unreadable log row is moved to `quarantined_updates` and skipped.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const chunks = this.exec('SELECT data FROM snapshot_chunks ORDER BY idx').map((r) => toBytes(r.data));
      if (chunks.length > 0) {
        try {
          applyStored(doc, joinChunks(chunks));
        } catch (e) {
          console.error(JSON.stringify({ event: 'board_snapshot_unreadable', error: message(e) }));
          return { ok: false, reason: 'snapshot-unreadable', error: message(e) };
        }
      }
      const through = this.snapshotThroughSeq();
      const rows = this.exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through);
      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const data = toBytes(row.data);
        try {
          applyStored(doc, data);
          count += 1;
          bytes += data.length;
        } catch (e) {
          this.quarantine(Number(row.seq), data, message(e));
          quarantined += 1;
        }
      }
      if (quarantined > 0) fillGaps(doc);
      this.logCount = count;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (e) {
      console.error(JSON.stringify({ event: 'board_load_sql_error', error: message(e) }));
      return { ok: false, reason: 'sql-error', error: message(e) };
    }
  }

  /**
   * When the log has reached a compaction threshold, replaces the snapshot with the whole of `doc` (which
   * already holds snapshot + log) and deletes the log, in one transaction. Returns true when it compacted.
   * Never throws: a failure rolls back (previous snapshot and log intact), is logged and returns false.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /** Compacts unconditionally (see `compactIfNeeded`). */
  compact(doc: Y.Doc): boolean {
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const maxSeq = Number(this.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates')[0].m);
        this.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, idx) => this.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, c));
        this.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.exec(
          "INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)",
          String(Math.max(maxSeq, this.snapshotThroughSeq())),
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'board_compaction_failed', error: message(e) }));
      return false;
    }
  }

  private snapshotThroughSeq(): number {
    const row = this.exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")[0];
    return row ? Number(row.value) : 0;
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      this.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board_update_quarantined', seq, error }));
  }
}
