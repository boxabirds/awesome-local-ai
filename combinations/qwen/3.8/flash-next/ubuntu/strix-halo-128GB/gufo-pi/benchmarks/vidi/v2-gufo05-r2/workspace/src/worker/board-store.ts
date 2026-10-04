/**
 * persist.board_store: the board's durable state, in the SQLite storage of its
 * own Durable Object.
 *
 * Layout (one database per board):
 *
 *   storage_meta        key/value pairs: `storage_schema_version`,
 *                       `snapshot_through_seq` (the log sequence the snapshot
 *                       already contains)
 *   updates             the append-only log of Yjs updates, in `seq` order
 *   snapshot_chunks     the compacted document, split into rows small enough for
 *                       the platform's per-row limit
 *   quarantined_updates log rows that could not be applied on load, moved aside
 *                       so the rest of the board still opens (persist.partial_damage)
 *
 * A board is therefore the snapshot plus every log row after it, which is what
 * makes saving continuous (persist.automatic) and independent of anyone being
 * present (persist.restart, persist.reopen).
 */

import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin for updates applied while loading a board: they come from
 * this board's own storage, so the room neither re-stores nor re-broadcasts them.
 */
export const LOAD_ORIGIN = 'vidi6.load';

const META_TABLE = 'storage_meta';
const LOG_TABLE = 'updates';
const CHUNK_TABLE = 'snapshot_chunks';
const QUARANTINE_TABLE = 'quarantined_updates';

const META_SCHEMA_VERSION_KEY = 'storage_schema_version';
const META_THROUGH_SEQ_KEY = 'snapshot_through_seq';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** What reading this board's storage last ended in, as its storage remembers it. */
export interface BoardHealth {
  /** When a read last failed, or null when the board reads fine. */
  failedAt: number | null;
  /** What went wrong then, for the log line and for diagnosing a broken board. */
  failure: string;
}

/** Everything the room and the test hooks want to know about one board's storage. */
export interface StorageSummary {
  schemaVersion: number | null;
  updateCount: number;
  updateBytes: number;
  snapshotChunks: number;
  snapshotThroughSeq: number;
  quarantined: number;
}

/** One log row, as read from the table. */
interface UpdateRow {
  seq: number;
  data: Uint8Array;
  bytes: number;
}

/**
 * Split `data` into chunks of at most `size` bytes. An empty input produces no
 * chunks, so a board with nothing in it writes no snapshot rows.
 */
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
  if (size < 1) throw new Error(`chunk size must be at least 1 byte, got ${size}`);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The inverse of `chunkBytes`: the chunks concatenated, in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** True when the log is big enough that compaction is worth doing. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Byte-for-byte identity of a stored BLOB column and the bytes put into it. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A BLOB column as bytes (the SQLite API hands out `ArrayBuffer`). */
export function fromArrayBuffer(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value);
}

/**
 * The board's log-and-snapshot store. Row counts and byte totals are kept in
 * memory (seeded by `load`) so appending never costs a `COUNT(*)`.
 */
export class BoardStore {
  /** Log rows in the table right now (all of them, whatever `throughSeq` is). */
  private logCount = 0;

  /** Bytes in those rows. */
  private logBytes = 0;

  /** Highest log sequence already folded into the snapshot. */
  private throughSeq = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  /** Create the tables and stamp the schema version. Writes no update rows. */
  migrate(): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec(
        `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
      sql.exec(
        `CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           data BLOB NOT NULL,
           bytes INTEGER NOT NULL
         )`,
      );
      sql.exec(`CREATE TABLE IF NOT EXISTS ${CHUNK_TABLE} (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`);
      sql.exec(
        `CREATE TABLE IF NOT EXISTS ${QUARANTINE_TABLE} (
           seq INTEGER PRIMARY KEY,
           data BLOB NOT NULL,
           error TEXT NOT NULL,
           quarantined_at INTEGER NOT NULL
         )`,
      );
      sql.exec(
        `INSERT OR IGNORE INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
        META_SCHEMA_VERSION_KEY,
        String(STORAGE_SCHEMA_VERSION),
      );
    });
  }

  /**
   * Append one Yjs update to the log, in the turn in which it was applied to the
   * document. SQL errors are rethrown: the room resets itself rather than keep
   * serving a board whose changes are not being kept.
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec(
      `INSERT INTO ${LOG_TABLE} (data, bytes) VALUES (?, ?)`,
      toArrayBuffer(update),
      update.byteLength,
    );
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Fill `doc` with the snapshot and every log row after it.
   *
   * A log row that cannot be read is moved to `quarantined_updates` and counted,
   * so one damaged change costs one change and not the board: the hole it leaves
   * in that author's history is closed as garbage-collected content, which is how
   * Yjs represents "this range existed and its content is gone", and the changes
   * after it integrate normally. An unreadable snapshot is different: most of the
   * board would be missing, so the caller is told `ok: false` and nothing is
   * deleted or quarantined.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      this.throughSeq = this.metaNumber(META_THROUGH_SEQ_KEY) ?? 0;

      const chunks = this.snapshotChunks();
      if (chunks.length > 0) {
        const snapshot = joinChunks(chunks);
        try {
          // Read it before applying it: noise must never reach the document.
          Y.decodeUpdate(snapshot);
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
        }
      }

      let kept = 0;
      let keptBytes = 0;
      let quarantined = 0;
      for (const row of this.logRowsAfter(this.throughSeq)) {
        let firstClock: Map<number, number>;
        try {
          firstClock = firstClockPerClient(row.data);
        } catch (error) {
          this.quarantine(row, describe(error));
          quarantined += 1;
          logQuarantined(row, describe(error));
          continue;
        }
        collectGap(doc, firstClock);
        try {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
          kept += 1;
          keptBytes += row.bytes;
        } catch (error) {
          this.quarantine(row, describe(error));
          quarantined += 1;
          logQuarantined(row, describe(error));
        }
      }
      this.logCount = kept;
      this.logBytes = keptBytes;
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }
  }

  // --- board health ------------------------------------------------------------
  //
  // How many times this board has been read, and when a read last failed. These
  // live in storage rather than in memory because a room with no sockets is not
  // promised a future: the point of the retry interval is that nobody re-reads a
  // broken board every time somebody connects to it, and a room that had to forget
  // everything would otherwise read a large, damaged board again on every wake.
  //
  // A failure that cannot be recorded (because storage itself is failing) is not
  // fatal: the room still remembers it for as long as it lives.

  health(): BoardHealth {
    const rows = this.storage.sql
      .exec(`SELECT key, value FROM ${META_TABLE} WHERE key IN ('load_failed_at', 'load_failure')`)
      .toArray();
    const value = (key: string): string | null => {
      const raw = rows.find((entry) => entry.key === key)?.value;
      return typeof raw === 'string' ? raw : null;
    };
    const failedAt = value('load_failed_at');
    return {
      failedAt: failedAt === null ? null : Number(failedAt),
      failure: value('load_failure') ?? '',
    };
  }

  /** Remember that a read failed, so that the retry can wait. */
  recordLoadFailure(now: number, failure: string): void {
    this.metaSet('load_failed_at', String(now));
    this.metaSet('load_failure', failure);
  }

  /** A read worked: forget the recorded failure. */
  recordLoadSuccess(): void {
    this.storage.sql.exec(
      `DELETE FROM ${META_TABLE} WHERE key = 'load_failed_at' OR key = 'load_failure'`,
    );
  }

  /**
   * Whether the log has crossed a threshold — the question a room asks before it
   * enters its Compacting state, so that state describes real work and not a
   * no-op pass over a short log.
   */
  needsCompaction(): boolean {
    return shouldCompact(this.logCount, this.logBytes);
  }

  /** Compact when the log crossed a threshold. Never throws. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /**
   * Replace the snapshot with `doc` and truncate the log, in one transaction: a
   * failure rolls back and leaves the previous snapshot and the whole log intact.
   */
  compact(doc: Y.Doc): boolean {
    let maxSeq = 0;
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      maxSeq = this.maxSeq();
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec(`DELETE FROM ${CHUNK_TABLE}`);
        chunks.forEach((chunk, index) => {
          sql.exec(`INSERT INTO ${CHUNK_TABLE} (idx, data) VALUES (?, ?)`, index, toArrayBuffer(chunk));
        });
        this.afterChunksDeleted(maxSeq);
        sql.exec(`DELETE FROM ${LOG_TABLE} WHERE seq <= ?`, maxSeq);
        sql.exec(
          `INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES (?, ?)`,
          META_THROUGH_SEQ_KEY,
          String(maxSeq),
        );
      });
      this.throughSeq = maxSeq;
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      // The transaction rolled back with the snapshot and the log as they were;
      // the board keeps running on them and tries again later.
      console.error(
        JSON.stringify({
          event: 'board_compaction_failed',
          throughSeq: this.throughSeq,
          attemptedThroughSeq: maxSeq,
          error: describe(error),
        }),
      );
      return false;
    }
  }

  /** Row counts and sizes, for the room's status and for tests. */
  private metaSet(key: string, value: string): void {
    this.storage.sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  summary(): StorageSummary {
    return {
      schemaVersion: this.metaNumber(META_SCHEMA_VERSION_KEY),
      updateCount: this.count(`SELECT COUNT(*) AS n FROM ${LOG_TABLE}`),
      updateBytes: this.count(`SELECT COALESCE(SUM(bytes), 0) AS n FROM ${LOG_TABLE}`),
      snapshotChunks: this.count(`SELECT COUNT(*) AS n FROM ${CHUNK_TABLE}`),
      snapshotThroughSeq: this.metaNumber(META_THROUGH_SEQ_KEY) ?? 0,
      quarantined: this.count(`SELECT COUNT(*) AS n FROM ${QUARANTINE_TABLE}`),
    };
  }

  /** The log rows a reload still has to apply, in the order they were written. */
  private logRowsAfter(seq: number): UpdateRow[] {
    const rows = this.storage.sql
      .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        `SELECT seq, data, bytes FROM ${LOG_TABLE} WHERE seq > ? ORDER BY seq ASC`,
        seq,
      )
      .toArray();
    return rows.map((row) => ({ seq: row.seq, data: fromArrayBuffer(row.data), bytes: row.bytes }));
  }

  /** The snapshot's chunks, in the order they concatenate to. */
  private snapshotChunks(): Uint8Array[] {
    return this.storage.sql
      .exec<{ data: ArrayBuffer }>(`SELECT data FROM ${CHUNK_TABLE} ORDER BY idx ASC`)
      .toArray()
      .map((row) => fromArrayBuffer(row.data));
  }

  /** Move one unreadable log row out of the log, keeping its bytes and the reason. */
  private quarantine(row: UpdateRow, error: string): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec(`DELETE FROM ${LOG_TABLE} WHERE seq = ?`, row.seq);
      sql.exec(
        `INSERT OR REPLACE INTO ${QUARANTINE_TABLE} (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
        row.seq,
        toArrayBuffer(row.data),
        error,
        Date.now(),
      );
    });
  }

  private maxSeq(): number {
    return this.count(`SELECT COALESCE(MAX(seq), 0) AS n FROM ${LOG_TABLE}`);
  }

  private count(query: string): number {
    const row = this.storage.sql.exec<{ n: number | string }>(query).one();
    return typeof row.n === 'number' ? row.n : Number(row.n);
  }

  private metaNumber(key: string): number | null {
    const rows = this.storage.sql
      .exec<{ value: string }>(`SELECT value FROM ${META_TABLE} WHERE key = ?`, key)
      .toArray();
    const value = rows[0]?.value;
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Called inside the compaction transaction, right after the old chunks are
   * gone and before the log is truncated. Always a no-op in production; a test
   * subclass throws here to prove the transaction rolls back and the board keeps
   * both its previous snapshot and its log.
   */
  protected afterChunksDeleted(_maxSeq: number): void {
    // Nothing to do.
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logQuarantined(row: UpdateRow, error: string): void {
  console.error(
    JSON.stringify({
      event: 'board_update_quarantined',
      seq: row.seq,
      bytes: row.bytes,
      error,
    }),
  );
}

/**
 * The clock each author's part of `update` starts at, reading the update without
 * applying it. Throws when the bytes are not an update at all.
 */
function firstClockPerClient(update: Uint8Array): Map<number, number> {
  const { structs } = Y.decodeUpdate(update);
  const clocks = new Map<number, number>();
  for (const struct of structs) {
    if (!clocks.has(struct.id.client)) clocks.set(struct.id.client, struct.id.clock);
  }
  return clocks;
}

/**
 * Close the hole in an author's history that the next log row expects to follow.
 *
 * Yjs integrates a change only once everything before it (from the same author) is
 * there, and stops at the first gap: the row after a lost or unreadable one would
 * otherwise be set aside for a predecessor that will never arrive, and every
 * change after that with it. Marking the missing range garbage-collected says what
 * is actually true — that content existed and is gone — and lets the board open
 * with everything after it. Normally there is nothing to close, so this costs a
 * state lookup per author per row.
 */
function collectGap(doc: Y.Doc, nextClock: Map<number, number>): void {
  for (const [client, clock] of nextClock) {
    const have = Y.getState(doc.store, client);
    if (clock <= have) continue;
    const structs = doc.store.clients.get(client) ?? [];
    structs.push(new Y.GC(Y.createID(client, have), clock - have));
    doc.store.clients.set(client, structs);
    console.error(
      JSON.stringify({ event: 'board_log_gap_collected', client, from: have, to: clock }),
    );
  }
}
