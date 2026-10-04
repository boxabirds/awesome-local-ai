/**
 * `BoardStore` — the board's saved state: a log of Yjs updates plus a compacted
 * snapshot, in the Durable Object's own SQLite database (one database per
 * board, kept for as long as the board exists; no story deletes a board).
 *
 * Everything here is synchronous on purpose: the SQLite API of a Durable Object
 * is synchronous, so an update can be written in the same turn in which it was
 * applied, before anybody else is told about it.
 *
 * Tables:
 *
 * ```sql
 * storage_meta        (key TEXT PRIMARY KEY, value TEXT NOT NULL)
 * updates             (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB, bytes INTEGER)
 * snapshot_chunks     (idx INTEGER PRIMARY KEY, data BLOB)
 * quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB, error TEXT, quarantined_at INTEGER)
 * ```
 *
 * Reading a board is "snapshot, then every update newer than it". One damaged
 * update row is moved to `quarantined_updates` and the rest of the board still
 * opens; a damaged *snapshot* is fatal (`snapshot-unreadable`), because most of
 * the board would be missing — the caller must not present that as an empty board.
 */

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin of everything applied *from storage*. Updates with this
 * origin are neither written back nor broadcast — a board loading itself is not
 * a new change.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** Outcome of loading a board into a document. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: LoadFailure; error: string };

export type LoadFailure =
  /** The saved board is most of the content and it does not add up: fail closed. */
  | 'snapshot-unreadable'
  /**
   * A row was skipped and what remains of the log no longer replays completely.
   * Yjs updates are diffs, so the changes stored after the hole cannot be
   * integrated; showing the board would show it quietly truncated.
   */
  | 'update-log-unreadable'
  /** The database itself failed. */
  | 'sql-error';

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';
const META_SNAPSHOT_DIGEST = 'snapshot_digest';
/**
 * When this board was created (epoch ms), written once by
 * {@link BoardStore.markCreated}. Its presence is what makes a board "exist"
 * in the story-5 sense; a board that predates story 5 has no such row but does
 * have saved content, and still counts as existing (see {@link
 * BoardStore.existsReadOnly}).
 */
const META_CREATED_AT = 'created_at';

/**
 * Integrity check of the snapshot as it was written.
 *
 * A Yjs update carries no checksum, and a changed byte inside one often decodes
 * perfectly into *different* content — a board with one altered word, or one
 * object missing, that looks fine. So the snapshot is stored together with a
 * digest of its bytes, and a board whose snapshot does not match it fails closed
 * instead of being shown. This detects corruption and truncation; it is not a
 * signature, and nothing here needs it to be: the bytes come from the same
 * board's own database.
 *
 * One pass, two mixed accumulators: a few milliseconds on the largest tested
 * snapshot, measured in the large-board e2e.
 */
export function checksum(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5 ^ bytes.byteLength;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i];
    h1 = Math.imul(h1 ^ byte, 0x01000193);
    h2 = Math.imul(h2 + byte, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (' +
    'seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
    'seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** SQLite accepts `ArrayBuffer`; a Yjs update may be a view over a bigger one. */
function toBinding(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function toBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * The clock range one update writes, per client. `to` is a floor: it counts one
 * clock position per struct, while an item such as a text insert spans as many
 * clock positions as it has characters. `from` is exact, and that is what a load
 * needs — it is where the update says this client's line continues.
 */
export interface UpdateRange {
  client: number;
  from: number;
  to: number;
}

/**
 * Read the header of a Yjs update (format v1): how many client blocks it holds,
 * and in each block how many structs it writes, for which client, starting at
 * which clock. Only the header is read, so this costs a hundredth of a
 * millisecond per update however big the update is.
 *
 * (`Y.encodeStateVectorFromUpdate` would be the published way to ask this; in yjs
 * 13.6.33 it returns nothing for most single-transaction updates, so the header is
 * read here. The order of the three numbers is checked against real yjs output in
 * the unit tests, because getting it wrong silently means reading no holes ever.)
 */
export function updateRanges(update: Uint8Array): UpdateRange[] {
  let pos = 0;
  const varUint = (): number => {
    let num = 0;
    let mult = 1;
    for (let shift = 0; shift < 10; shift++) {
      if (pos >= update.byteLength) throw new Error('update ends inside a number');
      const byte = update[pos++];
      num += (byte & 0x7f) * mult;
      mult *= 128;
      if ((byte & 0x80) === 0) return num;
    }
    throw new Error('number in update header is too long');
  };

  const clients = varUint();
  const ranges: UpdateRange[] = [];
  for (let i = 0; i < clients; i++) {
    const structs = varUint();
    const client = varUint();
    const from = varUint();
    ranges.push({ client, from, to: from + structs });
  }
  return ranges;
}

/**
 * The first range that starts further along a client's clock than the board has
 * reached, or `null` when every range continues a line the board is already on.
 *
 * Stored rows are a contiguous prefix per client, so a range starting beyond the
 * board's clock means a change is missing. Yjs will not complain about that: it
 * carries on and leaves a board that looks whole with content missing from the
 * middle, or with content quietly re-joined wrong — so it is checked here instead.
 *
 * Reading the board's clock costs about a thousandth of a millisecond, whatever
 * the board holds, because a state vector is one number per client.
 */
function clockGap(doc: Y.Doc, ranges: readonly UpdateRange[]): string | null {
  const reached = Y.decodeStateVector(Y.encodeStateVector(doc));
  for (const { client, from } of ranges) {
    const clock = reached.get(client) ?? 0;
    if (from > clock) {
      return `update log has a gap: client ${client} is at clock ${clock}, a stored update writes from ${from}`;
    }
  }
  return null;
}

/** Split `data` into chunks of at most `size` bytes (0 bytes → 0 chunks). */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size < 1) throw new Error(`chunk size must be at least 1 byte, got ${size}`);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The inverse of {@link chunkBytes}: concatenate in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** True when a log this large should be folded into a new snapshot. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

export class BoardStore {
  /** Rows of `updates` still in front of the snapshot, and their total size. */
  private logCount = 0;
  private logBytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  /**
   * Create the tables if needed and record the storage version. Writes no
   * update rows: opening a board that was never edited must not create content.
   *
   * Runs from {@link BoardRoom.initialize} (a board created through the API) and
   * lazily before the first {@link append} (a legacy board's first new change).
   * Reading a board never calls it, so probing an unknown link writes nothing.
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      for (const statement of SCHEMA_STATEMENTS) this.storage.sql.exec(statement);
      if (this.meta(META_SCHEMA_VERSION) === null) {
        this.setMeta(META_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
      }
      if (this.meta(META_SNAPSHOT_THROUGH) === null) {
        this.setMeta(META_SNAPSHOT_THROUGH, '0');
      }
    });
  }

  /**
   * True when this board exists. Read-only: it never creates a table, so asking
   * about an id that was never created leaves no storage behind (share.not_found).
   *
   * A board exists once {@link markCreated} has run (a board made through the
   * API), or — the legacy case, share.legacy_boards — it already has a saved
   * update or snapshot row from before story 5 shipped.
   */
  existsReadOnly(): boolean {
    if (!this.tableExists('storage_meta')) return false;
    if (this.meta(META_CREATED_AT) !== null) return true;
    const update = this.storage.sql.exec('SELECT 1 FROM updates LIMIT 1').toArray();
    if (update.length > 0) return true;
    const chunk = this.storage.sql.exec('SELECT 1 FROM snapshot_chunks LIMIT 1').toArray();
    return chunk.length > 0;
  }

  /** True when the board was created through the API (`created_at` is set). */
  isCreated(): boolean {
    return this.tableExists('storage_meta') && this.meta(META_CREATED_AT) !== null;
  }

  /** Record the creation time, once. Idempotent: a second call changes nothing. */
  markCreated(at = Date.now()): void {
    this.storage.transactionSync(() => {
      if (this.meta(META_CREATED_AT) === null) {
        this.setMeta(META_CREATED_AT, String(at));
      }
    });
  }

  /** The creation time (epoch ms), or `null` for a legacy or unknown board. */
  createdAt(): number | null {
    if (!this.tableExists('storage_meta')) return null;
    const raw = this.meta(META_CREATED_AT);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** The app tables present right now (diagnostics and the no-write guarantee). */
  tableNames(): string[] {
    return this.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => row.name);
  }

  /** Does this one table exist? Read-only; touches nothing else. */
  private tableExists(name: string): boolean {
    const rows = this.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name)
      .toArray();
    return rows.length > 0;
  }

  /** Everything the storage of one board holds, for diagnostics and tests. */
  stats(): { updates: number; updateBytes: number; chunks: number; throughSeq: number } {
    // A board that was never created has no tables; its stats are simply empty,
    // not an error (story 5: reads never create tables).
    if (!this.tableExists('updates')) {
      return { updates: 0, updateBytes: 0, chunks: 0, throughSeq: 0 };
    }
    const row = this.storage.sql
      .exec<{ count: number | null; bytes: number | null }>(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM updates',
      )
      .toArray()[0];
    const chunks = this.storage.sql
      .exec<{ count: number | null }>('SELECT COUNT(*) AS count FROM snapshot_chunks')
      .toArray()[0];
    return {
      updates: row?.count ?? 0,
      updateBytes: row?.bytes ?? 0,
      chunks: chunks?.count ?? 0,
      throughSeq: this.snapshotThroughSeq(),
    };
  }

  /**
   * Append one Yjs update to the log. SQL errors are rethrown: the caller can no
   * longer promise that anything is saved and resets the room.
   */
  append(update: Uint8Array): void {
    // The first write to a board creates its tables. Reads never do (so probing
    // an unknown link writes nothing); this is the one place that may.
    if (!this.tableExists('updates')) this.migrate();
    const bytes = update.byteLength;
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toBinding(update), bytes);
    this.logCount += 1;
    this.logBytes += bytes;
  }

  /**
   * Apply the snapshot and every update stored after it to `doc`.
   *
   * A log row that cannot be applied is moved to `quarantined_updates` (with the
   * error and the time) and counted, so one damaged change does not cost the
   * board. A snapshot that cannot be applied, or any SQL failure, is returned as
   * `ok: false` with nothing deleted or quarantined.
   *
   * When a row is skipped, the rows after it must still start where the board got
   * to: stored rows are a contiguous prefix of each client's clock line, and a row
   * that starts further along means the board is missing a change it cannot
   * recover. That is reported as a failure rather than opened, because half a board
   * shown as a whole board is the outcome this story exists to prevent.
   */
  load(doc: Y.Doc): LoadResult {
    // A board whose tables were never created is simply empty — and stays that
    // way. Creating them here would mean reading an unknown link wrote storage.
    if (!this.tableExists('storage_meta')) {
      this.logCount = 0;
      this.logBytes = 0;
      return { ok: true, quarantined: 0 };
    }
    try {
      const through = this.snapshotThroughSeq();
      const chunks = this.storage.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC',
        )
        .toArray();
      if (chunks.length === 0 && through > 0) {
        // The snapshot claims to cover updates whose rows are gone with it. Reading
        // on would answer "this board is empty", which is the one thing a load must
        // never say when it is not sure.
        return {
          ok: false,
          reason: 'snapshot-unreadable',
          error: `the snapshot covers update ${through}, but no snapshot chunk is left`,
        };
      }
      if (chunks.length > 0) {
        const snapshot = joinChunks(chunks.map((chunk) => toBytes(chunk.data)));
        const expected = this.meta(META_SNAPSHOT_DIGEST);
        if (expected === null) {
          // A snapshot without the digest written alongside it cannot be verified,
          // and a chunk set that lost its digest row has lost something.
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: `${chunks.length} snapshot chunk(s) with no recorded digest`,
          };
        }
        if (checksum(snapshot) !== expected) {
          // Reading on would either throw halfway or show a board with content
          // quietly changed. Both are worse than saying the board could not load.
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: `snapshot digest mismatch (expected ${expected}, read ${checksum(snapshot)} of ${snapshot.byteLength} bytes)`,
          };
        }
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: reason(error) };
        }
      }

      const rows = this.storage.sql
        .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
          'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq ASC',
          through,
        )
        .toArray();

      let quarantined = 0;
      let kept = 0;
      let keptBytes = 0;
      for (const row of rows) {
        const update = toBytes(row.data);
        let ranges: UpdateRange[];
        try {
          ranges = updateRanges(update);
        } catch (error) {
          this.quarantine(row.seq, update, `unreadable update header: ${reason(error)}`);
          quarantined += 1;
          continue;
        }
        const gap = clockGap(doc, ranges);
        if (gap !== null) {
          // Everything after here is untrustworthy too, and the document now holds
          // part of the board. The caller discards it: see `BoardRoom.loadBoard`.
          return {
            ok: false,
            reason: 'update-log-unreadable',
            error: `${gap} (row ${row.seq} of ${rows.length} read)`,
          };
        }
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
        } catch (error) {
          this.quarantine(row.seq, update, reason(error));
          quarantined += 1;
          continue;
        }
        kept += 1;
        keptBytes += row.bytes;
      }
      this.logCount = kept;
      this.logBytes = keptBytes;
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: reason(error) };
    }
  }

  /** True when the log in front of the snapshot is big enough to fold away. */
  get compactionDue(): boolean {
    return shouldCompact(this.logCount, this.logBytes);
  }

  /** How many update rows are still waiting in front of the snapshot. */
  get pendingUpdates(): number {
    return this.logCount;
  }

  /**
   * Fold the log into a fresh snapshot when it grew past a threshold, so a board
   * never has to replay its whole history. Returns `true` when it wrote a new
   * snapshot, `false` for a no-op and for a failure it rolled back (previous
   * snapshot and log intact). Never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.compactionDue) return false;
    return this.compact(doc);
  }

  /**
   * Compact regardless of the thresholds, in one transaction: the snapshot is
   * replaced and every row it covers is deleted together, so a crash between the
   * two cannot lose board content.
   */
  compact(doc: Y.Doc): boolean {
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded, SNAPSHOT_CHUNK_BYTES);
      this.storage.transactionSync(() => {
        const row = this.storage.sql
          .exec<{ max_seq: number | null }>('SELECT MAX(seq) AS max_seq FROM updates')
          .toArray()[0];
        const maxSeq = row?.max_seq ?? 0;
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (const [index, chunk] of chunks.entries()) {
          this.storage.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            index,
            toBinding(chunk),
          );
        }
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        const through = Math.max(this.snapshotThroughSeq(), maxSeq);
        this.setMeta(META_SNAPSHOT_THROUGH, String(through));
        this.setMeta(META_SNAPSHOT_DIGEST, checksum(encoded));
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      // `transactionSync` rolled the whole thing back: the board is still exactly
      // as it was, and the log will be folded on the next change.
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', error: reason(error), rolledBack: true }),
      );
      return false;
    }
  }

  // --- internals ------------------------------------------------------------

  /** The seq of the last update folded into the snapshot (0 when there is none). */
  snapshotThroughSeq(): number {
    const raw = this.meta(META_SNAPSHOT_THROUGH);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /** Move one unreadable update out of the log and remember why. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    try {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          toBinding(data),
          error,
          Date.now(),
        );
        this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      });
    } catch (moveError) {
      // The row stays where it is and will be skipped again on the next load;
      // the board still opened with everything else.
      console.error(
        JSON.stringify({
          event: 'board-update-quarantine-failed',
          seq,
          error: reason(moveError),
        }),
      );
      return;
    }
    console.error(
      JSON.stringify({ event: 'board-update-quarantined', seq, error, bytes: data.byteLength }),
    );
  }

  private meta(key: string): string | null {
    const rows = this.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray();
    return rows.length > 0 ? rows[0].value : null;
  }

  private setMeta(key: string, value: string): void {
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }
}
