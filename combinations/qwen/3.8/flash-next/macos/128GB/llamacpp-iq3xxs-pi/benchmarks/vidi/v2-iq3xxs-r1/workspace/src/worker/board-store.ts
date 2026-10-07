import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin for every update applied while loading a saved board.
 * `BoardRoom` uses it to tell "the room rebuilt its document from storage" (do
 * not re-store it, do not broadcast it) from "a client sent a change" (store it,
 * then broadcast it).
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/**
 * The result of loading a board into a `Y.Doc`.
 *
 * - `ok: true` — the doc now holds everything that could be read; `quarantined`
 *   counts log rows that were unreadable and moved aside (PRD persist.partial_damage).
 * - `snapshot-unreadable` — the snapshot could not be applied, so most of the board
 *   is gone: the room refuses to serve an empty doc (PRD persist.load_failure) and
 *   nothing is deleted or quarantined.
 * - `sql-error` — SQLite itself failed on read; the board's state is unknown, so it
 *   is treated exactly like an unreadable snapshot.
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Split `data` into at most `size`-byte chunks; never an empty chunk (TC-01). */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new RangeError(`chunk size must be positive, got ${size}`);
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    out.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return out;
}

/** Concatenate chunks back into one buffer, byte for byte (TC-01). */
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

/** Compact when either the row count or the byte total reaches its threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** A standalone `ArrayBuffer` for a SQLite BLOB binding (never a view). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

/**
 * A board's whole history in one Durable Object's SQLite database.
 *
 * The layout is a snapshot plus a log:
 *
 * - `updates` is an append-only log of every Yjs update, so a change is durable
 *   the moment the room writes it — no save button, and nothing is lost when the
 *   last person leaves or the service restarts (PRD persist.automatic,
 *   persist.restart, persist.reopen).
 * - Compaction folds the log into `snapshot_chunks` (a `Y.encodeStateAsUpdate`
 *   of the current document, chunked to stay under the platform per-row size
 *   limit), so a long-lived board's wake never replays every keystroke ever made.
 * - `quarantined_updates` holds log rows that no longer apply. One damaged change
 *   is moved aside and the rest of the board still loads (PRD persist.partial_damage).
 *
 * Every statement goes through `exec`, which exists so integration tests can wrap
 * it to fail a specific statement inside a `transactionSync` and watch the real
 * rollback happen (TC-11) while SQLite semantics stay real.
 */
export class BoardStore {
  private readonly storage: DurableObjectStorage;
  private readonly boardId: string;
  /** `updates` row count and byte total, tracked in memory after load (no COUNT(*) per write). */
  private rows = 0;
  private bytes = 0;

  constructor(storage: DurableObjectStorage, boardId = 'board') {
    this.storage = storage;
    this.boardId = boardId;
  }

  /** Structured log line: board id and event always present (design "Logging"). */
  private log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
    const json = JSON.stringify({ level, board: this.boardId, event, ...fields });
    if (level === 'warn') console.warn(json);
    else if (level === 'info') console.info(json);
    else console.error(json);
  }

  /**
   * Create the tables and stamp the storage version if absent. Writes no update
   * rows: opening a board that was never edited leaves the log and snapshot empty
   * (TC-25) so it opens as a genuinely empty board, not a half-built one.
   */
  migrate(): void {
    this.transaction(() => {
      this.exec(
        'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
      this.exec(
        'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
      );
      this.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      this.exec(
        'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
      );
      if (this.getMeta(META_SCHEMA_VERSION) === undefined) {
        this.setMeta(META_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
      }
    });
  }

  /**
   * Append one Yjs update to the log. Runs synchronously, so the row is durable in
   * the same turn the change was applied and before anything is broadcast. SQL
   * errors are rethrown: the caller (BoardRoom) then resets the room, because a
   * board it cannot write is a board it must not keep serving (PRD persist.save_failure).
   */
  append(update: Uint8Array): void {
    const size = update.byteLength;
    // transactionSync throws if SQLite rejects the statement, leaving the counters
    // untouched so they stay the truth about the table.
    this.transaction(() => {
      this.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toArrayBuffer(update), size);
    });
    this.rows += 1;
    this.bytes += size;
  }

  /**
   * Rebuild `doc` from the snapshot plus every log row after it.
   *
   * A snapshot that will not apply is fatal (`snapshot-unreadable`) — the board is
   * mostly unreadable and must not be presented as empty. A single log row that
   * will not apply is quarantined and counted, and the rest of the board loads
   * (PRD persist.partial_damage). Any SQL failure is reported as `sql-error`; in
   * both cases nothing is deleted or quarantined, so a retry sees the same bytes.
   */
  load(doc: Y.Doc): LoadResult {
    const started = Date.now();
    try {
      const snapshotBytes = this.readSnapshotBytes();
      if (snapshotBytes.length > 0) {
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
        }
      }

      const through = this.snapshotThroughSeq();
      const rows = this.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq ASC',
        through,
      ).toArray();

      let quarantined = 0;
      for (const row of rows) {
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
        } catch (error) {
          this.quarantine(row.seq, row.data, describe(error));
          quarantined += 1;
        }
      }

      // Remember what is left so append/shouldCompact stay exact without a COUNT(*).
      this.recount();
      // `load_ms` (TC-21) reports against the 2000-note budget.
      this.log('info', 'load_succeeded', {
        durationMs: Date.now() - started,
        logRows: this.rows,
        quarantined,
      });
      return { ok: true, quarantined };
    } catch (error) {
      // SQL failed on read: the board's state is unknown, so refuse to serve it.
      this.log('error', 'load_failed', { durationMs: Date.now() - started, error: describe(error).slice(0, 100) });
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }
  }

  /**
   * Fold the log into a fresh snapshot when it has grown past a threshold. Returns
   * true if it compacted, false for a no-op or a rolled-back failure; it never
   * throws — a failed compaction rolls its whole transaction back, leaving the old
   * snapshot and log exactly as they were (TC-11).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rows, this.bytes)) return false;
    const started = Date.now();
    this.log('info', 'compaction_started', { rows: this.rows, bytes: this.bytes });

    // The in-memory doc already holds snapshot + log, so one encodeStateAsUpdate
    // captures the whole board. Yjs garbage-collects deleted content, so its size
    // tracks current content, not history.
    const encoded = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(encoded);
    const maxSeq = this.maxSeq();

    try {
      this.transaction(() => {
        this.exec('DELETE FROM snapshot_chunks');
        let idx = 0;
        for (const chunk of chunks) {
          this.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, toArrayBuffer(chunk));
          idx += 1;
        }
        // Only rows already covered by the snapshot leave the log; anything a client
        // appended after `maxSeq` stays.
        if (maxSeq > 0) this.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.setMeta(META_SNAPSHOT_THROUGH_SEQ, String(maxSeq));
      });
    } catch (error) {
      // transactionSync rolled every statement back: previous snapshot and log intact.
      this.log('error', 'compaction_rolled_back', {
        throughSeq: maxSeq,
        error: describe(error).slice(0, 100),
        durationMs: Date.now() - started,
      });
      this.recount();
      return false;
    }

    this.recount();
    this.log('info', 'compaction_succeeded', {
      throughSeq: maxSeq,
      chunks: chunks.length,
      durationMs: Date.now() - started,
    });
    return true;
  }

  // ------------------------------------------------------------------ internals

  private readSnapshotBytes(): Uint8Array {
    const chunks = this.exec<{ idx: number; data: ArrayBuffer }>(
      'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC',
    ).toArray();
    return joinChunks(chunks.map((row) => new Uint8Array(row.data)));
  }

  private snapshotThroughSeq(): number {
    return Number(this.getMeta(META_SNAPSHOT_THROUGH_SEQ) ?? '0') || 0;
  }

  /** Move one unreadable log row out of the log and into the quarantine table. */
  private quarantine(seq: number, data: ArrayBuffer, error: string): void {
    this.transaction(() => {
      this.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
    });
    this.log('warn', 'load_row_quarantined', { seq, error: error.slice(0, 100) });
  }

  private maxSeq(): number {
    const row = this.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates').next();
    return row.done ? 0 : (row.value.m ?? 0);
  }

  private recount(): void {
    const row = this.exec<{ c: number; b: number }>(
      'SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM updates',
    ).one();
    this.rows = row.c;
    this.bytes = row.b;
  }

  private getMeta(key: string): string | undefined {
    const row = this.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key).next();
    return row.done ? undefined : row.value.value;
  }

  private setMeta(key: string, value: string): void {
    this.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  private transaction<T>(run: () => T): T {
    return this.storage.transactionSync(run);
  }

  /**
   * The single place every SQL statement is issued. Wrapping this (in tests) to
   * fail one statement still runs SQLite, so `transactionSync` rolls the whole
   * transaction back for real (design "Mock vs real boundaries").
   */
  private exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): SqlStorageCursor<T> {
    return this.storage.sql.exec<T>(query, ...bindings);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
