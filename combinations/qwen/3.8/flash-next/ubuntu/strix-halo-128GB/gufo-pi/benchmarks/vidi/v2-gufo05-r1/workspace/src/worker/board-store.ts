/**
 * A board's storage: the log of every Yjs update it ever received, and the snapshot
 * the log is periodically folded into.
 *
 * Three ideas carry the story:
 *
 * - **Append-only in the normal case.** Every update the room applies is written
 *   here, so a board is saved as it is edited and there is nothing to press. The
 *   SQL is synchronous, which is what lets the room write the row and only then
 *   broadcast the change.
 * - **The log is folded, not replayed forever.** A board edited for a month would
 *   otherwise read back every keystroke and drag frame at its next opening. Past
 *   `COMPACTION_UPDATE_COUNT` rows or `COMPACTION_BYTES`, the whole document is
 *   encoded once, cut into `SNAPSHOT_CHUNK_BYTES` rows and the log truncated, so an
 *   opening reads one snapshot plus a bounded tail.
 * - **Damage is local.** A log row that will not apply is moved to
 *   `quarantined_updates` and the rest of the board loads. A snapshot that will not
 *   apply is fatal to the load, because it holds most of the board: the caller is
 *   told `ok: false` so it can refuse to serve an empty board rather than pretend.
 *
 * Nothing here talks to clients. The close codes, the retry interval and the
 * message on the screen belong to `board-room.ts` and the client.
 */
import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Origin of the transactions that put a saved board into a document. The room does
 * not store or broadcast what came out of its own storage.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** Keys of `storage_meta`. */
const SCHEMA_VERSION_KEY = 'storage_schema_version';
const SNAPSHOT_THROUGH_SEQ_KEY = 'snapshot_through_seq';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
] as const;

/** What a load produced: how many rows had to be quarantined, or why it failed. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Cut a snapshot into rows. Returns no chunks for no bytes, so an empty snapshot is
 * indistinguishable from no snapshot in storage — which is what the loader wants.
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${String(size)}`);
  }
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += size) {
    chunks.push(data.slice(start, Math.min(start + size, data.byteLength)));
  }
  return chunks;
}

/** Put the rows back in order. The exact inverse of `chunkBytes`. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Whether the log has grown past either of its limits. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

interface UpdateRow {
  seq: number;
  data: Uint8Array;
}

/**
 * The board's own SQLite database (one per Durable Object, so one per board).
 *
 * The row count and byte total are kept in memory after a load: a board writes an
 * update per keystroke-batch, and none of them should pay for a `COUNT(*)`.
 */
export class BoardStore {
  private logRows = 0;
  private logBytes = 0;
  /** Whether this instance has read the board. Until then its counters say nothing. */
  private hasLoaded = false;

  constructor(private readonly storage: DurableObjectStorage) {}

  /** Create the tables and record the storage version. Writes no update rows. */
  migrate(): void {
    const sql = this.storage.sql;
    for (const statement of SCHEMA_STATEMENTS) sql.exec(statement);
    sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
      SCHEMA_VERSION_KEY,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /**
   * Store one update. Throws whatever SQLite throws — the room is the one that knows
   * what a board it cannot write to is for, and it must not broadcast first.
   */
  append(update: Uint8Array): void {
    const bytes = update.byteLength;
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toBinding(update), bytes);
    this.logRows += 1;
    this.logBytes += bytes;
  }

  /**
   * Fill `doc` with everything the board has: the snapshot, then the log rows after
   * it, oldest first.
   *
   * A row that will not apply is quarantined and counted, and the rest of the board
   * still arrives. A snapshot that will not apply, or SQL that will not answer, is
   * reported to the caller as a failed load with nothing deleted — an unreadable
   * snapshot has to be repaired or retried, not quietly thrown away.
   */
  load(doc: Y.Doc): LoadResult {
    let snapshot: Uint8Array | null;
    let throughSeq: number;
    let rows: UpdateRow[];
    try {
      snapshot = this.readSnapshot();
      throughSeq = this.metaNumber(SNAPSHOT_THROUGH_SEQ_KEY, 0);
      rows = this.readLogAfter(throughSeq);
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }

    if (snapshot !== null) {
      try {
        Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
      } catch (error) {
        return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
      }
    }

    let quarantined = 0;
    let appliedRows = 0;
    let appliedBytes = 0;
    for (const row of rows) {
      try {
        Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
        appliedRows += 1;
        appliedBytes += row.data.byteLength;
      } catch (error) {
        try {
          this.quarantine(row, describe(error));
        } catch (quarantineError) {
          // The row is still there and still unreadable; the next load will try
          // again. Better a repeated warning than a load that dies over its diary.
          console.error(
            JSON.stringify({
              event: 'board-update-quarantine-failed',
              seq: row.seq,
              error: describe(quarantineError),
            }),
          );
          continue;
        }
        quarantined += 1;
        console.error(
          JSON.stringify({
            event: 'board-update-quarantined',
            seq: row.seq,
            bytes: row.data.byteLength,
            error: describe(error),
          }),
        );
      }
    }

    this.logRows = appliedRows;
    this.logBytes = appliedBytes;
    this.hasLoaded = true;
    return { ok: true, quarantined };
  }

  /**
   * Fold the log into a snapshot, if it has grown enough to be worth it.
   *
   * An instance that has not loaded the board yet asks SQLite instead of trusting its
   * own zeroes: a fresh store that quietly believed "nothing to do" would leave a
   * board with a hundred thousand rows uncompacted forever.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(...this.measuredLogSize())) return false;
    return this.compact(doc);
  }

  /**
   * Fold the log into a snapshot whatever its size. Used by the room when a board
   * is known to be at rest, and by the e2e test hooks, which need a snapshot to
   * damage on purpose.
   */
  compactSnapshot(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  /**
   * The size of the log: the numbers kept in memory after a load, so that an append
   * does not pay for a `COUNT(*)`. An instance that has not read the board yet asks
   * SQLite rather than reporting an empty log it knows nothing about.
   */
  logStats(): { rows: number; bytes: number } {
    const [rows, bytes] = this.measuredLogSize();
    return { rows, bytes };
  }

  private measuredLogSize(): [number, number] {
    if (this.hasLoaded) return [this.logRows, this.logBytes];
    const row = this.storage.sql
      .exec('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS total FROM updates')
      .one() as { count: number; total: number };
    return [row.count, row.total];
  }

  /**
   * One transaction: new snapshot in, old snapshot and folded rows out.
   *
   * It never throws. If any statement fails the transaction is rolled back — the old
   * snapshot and the whole log are still there — and `false` is returned, because a
   * board that has not been compacted is merely slower to open, while a board that
   * has been compacted badly is gone.
   */
  private compact(doc: Y.Doc): boolean {
    let lastSeq = 0;
    let encoded: Uint8Array;
    try {
      const row = this.storage.sql.exec('SELECT MAX(seq) AS maxSeq FROM updates').one() as {
        maxSeq: number | null;
      };
      lastSeq = row.maxSeq ?? 0;
      if (lastSeq === 0) return false; // nothing in the log to fold away
      // The document in memory already holds the snapshot and every row after it,
      // so encoding it once replaces both.
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', stage: 'encode', error: describe(error) }),
      );
      return false;
    }

    const chunks = chunkBytes(encoded);
    const throughSeq = lastSeq;
    try {
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        for (const [index, chunk] of chunks.entries()) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, toBinding(chunk));
        }
        sql.exec('DELETE FROM updates WHERE seq <= ?', throughSeq);
        sql.exec(
          `INSERT INTO storage_meta (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          SNAPSHOT_THROUGH_SEQ_KEY,
          String(throughSeq),
        );
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'board-compaction-failed',
          stage: 'transaction',
          rolledBack: true,
          error: describe(error),
        }),
      );
      return false;
    }

    this.logRows = 0;
    this.logBytes = 0;
    return true;
  }

  /** Move one unreadable row out of the log, keeping its bytes and the reason. */
  private quarantine(row: UpdateRow, error: string): void {
    const bytes = toBinding(row.data);
    const at = Date.now();
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
      sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        row.seq,
        bytes,
        error,
        at,
      );
    });
  }

  private readSnapshot(): Uint8Array | null {
    const rows = this.storage.sql
      .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
      .toArray() as { data: unknown }[];
    if (rows.length === 0) return null;
    return joinChunks(rows.map((row) => toBytes(row.data)));
  }

  private readLogAfter(throughSeq: number): UpdateRow[] {
    const rows = this.storage.sql
      .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq)
      .toArray() as { seq: number; data: unknown }[];
    // Materialised before anything is applied: a damaged row deletes itself, and no
    // cursor should be open over the table while that happens.
    return rows.map((row) => ({ seq: row.seq, data: toBytes(row.data) }));
  }

  private metaNumber(key: string, fallback: number): number {
    const rows = this.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray() as {
      value: string;
    }[];
    const stored = rows[0]?.value;
    if (stored === undefined) return fallback;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

/** SQLite takes blobs as `ArrayBuffer`s; a Yjs update may view a larger buffer. */
function toBinding(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`SQLite returned a value that is not bytes: ${Object.prototype.toString.call(value)}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
