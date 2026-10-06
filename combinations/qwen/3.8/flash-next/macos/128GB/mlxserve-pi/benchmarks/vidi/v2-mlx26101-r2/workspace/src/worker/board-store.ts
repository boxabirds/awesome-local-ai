/**
 * The board's storage: one SQLite database per board, inside its Durable Object
 * (design "Board storage").
 *
 * The layout is a snapshot plus a log — the shape every append-only CRDT store
 * ends up in, and the one that fits how a board is edited:
 *
 * - `updates` holds every Yjs update the board ever received, in the order it
 *   arrived. A change is written there the moment it is applied, so nothing depends
 *   on anyone pressing save.
 * - `snapshot_chunks` holds the encoded board, in rows of at most
 *   `SNAPSHOT_CHUNK_BYTES` (the platform caps how big one row may be).
 * - `snapshot_through_seq` in `storage_meta` says how much of the log that snapshot
 *   already contains, so a load applies the snapshot and then only the rows after
 *   it.
 * - `quarantined_updates` holds log rows that no longer decode.
 *
 * Compaction folds the log into the snapshot, which is what bounds the work a load
 * does: one snapshot plus fewer than `COMPACTION_UPDATE_COUNT` rows, however long
 * a board has been lived in.
 *
 * Damage is treated by size. A log row that cannot be decoded is one person's one
 * change: it is moved aside and the rest of the board loads. A snapshot that
 * cannot be decoded is most of the board: `load` says so, and the room refuses to
 * serve an empty board for it (design key decision 5).
 *
 * Everything here is synchronous, which is what the Durable Object SQLite API
 * gives and what lets the room write a change before it broadcasts it.
 */

import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config.js';

/** The value of `storage_meta.snapshot_through_seq`. */
export const SNAPSHOT_THROUGH_SEQ_KEY = 'snapshot_through_seq';
/** The value of `storage_meta.storage_schema_version`. */
export const STORAGE_SCHEMA_VERSION_KEY = 'storage_schema_version';
/**
 * The value of `storage_meta.created_at`: the moment this board was created, in
 * epoch milliseconds. Writing it is what making a board *is* (design "Existence
 * rule"), and it is written once, by `initialize()`, never again.
 *
 * A board can exist without it: every board this app made before story 5 has the
 * tables and the rows and no `created_at`, and opening one of those still opens
 * the board (PRD `share.legacy_boards`). So `created_at` is how a board says it was
 * made, and rows are how a board says it has something in it.
 */
export const CREATED_AT_KEY = 'created_at';

/** The tables of this schema, named for the read-only existence check below. */
const TABLE_NAMES: readonly string[] = [
  'storage_meta',
  'updates',
  'snapshot_chunks',
  'quarantined_updates',
];

/**
 * Origin of every update the store applies *into* a document while loading it. It
 * is how the room tells "this is the board being read back" from "this is a
 * person's change": the first is already in storage and must not be written again,
 * the second has to be.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** A value SQLite accepts in a BLOB, TEXT or INTEGER column, or `null`. */
export type SqlValue = string | number | ArrayBuffer | null;

/** A row of `updates`, as read back. */
type UpdateRow = { seq: number; data: ArrayBuffer; bytes: number };
/** A row of `snapshot_chunks`, as read back. */
type ChunkRow = { idx: number; data: ArrayBuffer };
/** A `storage_meta` row. */
type MetaRow = { value: string };
/** The result of `SELECT MAX(seq)`, which is null in an empty log. */
type MaxSeqRow = { seq: number | null };

/** The tables of `STORAGE_SCHEMA_VERSION`, created if absent. */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
];

/** What a load did: how much damage it set aside, or why it stopped. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** `bytes` as a buffer of its own, which is what SQLite binds to a BLOB. */
const blob = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A BLOB column as bytes (the runtime hands them back as `ArrayBuffer`). */
const bytesOf = (value: ArrayBuffer): Uint8Array => new Uint8Array(value);

/** What went wrong, in a column that is `TEXT NOT NULL`. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message || error.name : String(error);

/**
 * Split `data` into pieces of at most `size` bytes: 0 bytes → 0 chunks, 1 byte → 1
 * chunk, exactly `size` → 1 chunk, `size` + 1 → 2. A snapshot is stored in pieces
 * so that no single row approaches the platform's per-row size limit.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isFinite(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The chunks of a snapshot, back in order and byte for byte identical. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/**
 * Is the log past the point where folding it into the snapshot is worth it? Either
 * threshold on its own is enough: the count bounds how many rows a load replays,
 * the byte total bounds how much of it has to be read.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * The bytes Yjs is holding back because something that came before them is missing:
 * `doc.store.pendingStructs`. It is Yjs's own way of saying "these bytes are fine,
 * but I have not seen what they build on yet" — which is exactly what a quarantined
 * log row leaves behind.
 */
type PendingStructs = {
  /** For each writer, the clock before the one it is waiting for. */
  missing: Map<number, number>;
  /** The bytes waiting for it. */
  update: Uint8Array;
};

const pendingStructsOf = (doc: Y.Doc): PendingStructs | null => {
  const pending = (doc.store as unknown as { pendingStructs?: PendingStructs | null })
    .pendingStructs;
  return pending ?? null;
};

/** How many holes one load will close, so a load cannot loop for ever. */
const CLOSE_HOLE_LIMIT = 16;

/**
 * An update that marks the missing range of every writer in `missing` as collected,
 * given the state `stateVector` says the document already has.
 *
 * Why this is needed: a row that was quarantined leaves a gap in its writer's
 * clock, and Yjs will not integrate the rows after such a gap — it holds them in
 * `store.pendingStructs` in case the missing bytes turn up later. Left alone, a
 * board with one damaged row would come back missing *everything made after it*.
 * Marking the gap as collected is how Yjs represents content it is not keeping any
 * more, so the gap stops being a question and the rows behind it are integrated.
 * The damaged change is the only thing lost, which is what "one damaged change does
 * not lose the board" asks for.
 *
 * Returns `null` when there is nothing to close: the range is already covered, or
 * the missing bytes may still be on their way and must not be declared lost.
 */
export function gapFillUpdate(
  stateVector: Uint8Array,
  missing: Map<number, number>,
): Uint8Array | null {
  const have = Y.decodeStateVector(stateVector);
  const parts: Array<[client: number, clock: number, length: number]> = [];
  for (const [client, missingClock] of missing) {
    const clock = have.get(client) ?? 0;
    // Up to and including the missing clock: the rows waiting in `pendingStructs`
    // start there, and Yjs integrates them once the state reaches past it.
    const length = missingClock + 1 - clock;
    if (length > 0) parts.push([client, clock, length]);
  }
  if (parts.length === 0) return null;

  // The update format, written out by hand because there is nothing to transact:
  // a header, then per client the number of structs, the client, its first clock,
  // and the structs. The one struct per client is a GC struct — info byte 0 and a
  // length — which means "these clocks are gone, do not ask for them again".
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, parts.length);
  for (const [client, clock, length] of parts) {
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, clock);
    encoding.writeUint8(encoder, 0);
    encoding.writeVarUint(encoder, length);
  }
  // And an empty delete set: this change deletes nothing that we have.
  encoding.writeVarUint(encoder, 0);
  return encoding.toUint8Array(encoder);
}

/**
 * The board's storage. One per Durable Object instance; the room hands it
 * `ctx.storage` and does not look behind this interface.
 */
export class BoardStore {
  /** Rows of the log that are not in the snapshot, and their total size. Kept in
   * memory so appending does not have to count the table on every keystroke. */
  private log = { count: 0, bytes: 0 };

  /** How much of the log the snapshot already contains (0 when there is none). */
  private snapshotThrough = 0;

  /**
   * Whether the tables of this board are known to be there. It starts false because
   * this store does not know: an object woken for a link that was never created has
   * no tables and must not make any, and an object woken for a board that has them
   * does not need to be told.
   *
   * The only things that set it are `migrate()` — which is `initialize()`, and the
   * lazy step in front of the first `append()` — and nothing else.
   */
  private tablesKnown = false;

  constructor(protected readonly storage: DurableObjectStorage) {}

  /**
   * Create the tables and record their version. Idempotent, and it writes no update
   * rows: a board that was never edited stays an empty board, and opening one must
   * not make it "have" something.
   *
   * Story 5 narrowed who may call it. It used to be the first thing every object did,
   * which is how a board came to exist just because somebody typed an address at it;
   * now it is called by `initialize()`, which is what making a board means, and once
   * more in front of the first `append()`, for a board that was made before there was
   * an `initialize()` to make it with.
   */
  migrate(): void {
    for (const statement of SCHEMA_STATEMENTS) this.exec(statement);
    if (this.metaGet(STORAGE_SCHEMA_VERSION_KEY) === null) {
      this.metaSet(STORAGE_SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    }
    this.tablesKnown = true;
  }

  /**
   * Does this board exist? Read-only in the strong sense: the first statement is
   * against `sqlite_master`, so a board that was never made costs one small lookup
   * and no tables, rather than a schema built in order to discover it is empty
   * (design "Existence rule", and the negative test that probing writes nothing).
   *
   * Two answers are yes. `created_at` is the ordinary one. The other is a board with
   * rows and no `created_at`, which is every board this app made before story 5: it
   * has a board in it, so it is one (PRD `share.legacy_boards`). A board with nothing
   * in it at all, and no `created_at` because it was never clicked into existence, is
   * a board that does not exist — which is what lets a mistyped link be answered
   * honestly instead of with an empty board that looks like stolen work.
   */
  existsReadOnly(): boolean {
    const present = this.presentTables();
    if (present.size === 0) return false;
    if (present.has('storage_meta') && this.metaGet(CREATED_AT_KEY) !== null) return true;
    // No `created_at` (or nowhere that would hold one): the board is what its
    // contents are. Both counts tolerate a table this board never had, so a storage
    // layout that is part-built says what it has rather than throwing.
    return this.countRows('updates', present) + this.countRows('snapshot_chunks', present) > 0;
  }

  /** When this board was created, or null when nothing created it. */
  createdAt(): number | null {
    if (!this.presentTables().has('storage_meta')) return null;
    const stored = this.metaGet(CREATED_AT_KEY);
    const at = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(at) ? at : null;
  }

  /**
   * Say that this board has been made. Returns the stored value either way: a board
   * that already had one keeps it, unchanged, because `created_at` is a fact about
   * when a board began and not a timestamp to be refreshed (TC-15).
   */
  markCreated(at: number): number {
    this.migrate();
    const existing = this.createdAt();
    if (existing !== null) return existing;
    this.metaSet(CREATED_AT_KEY, String(at));
    return at;
  }

  /** The version of the tables this board was created with. */
  schemaVersion(): number {
    if (!this.presentTables().has('storage_meta')) return 0;
    const stored = this.metaGet(STORAGE_SCHEMA_VERSION_KEY);
    const version = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(version) ? version : 0;
  }

  /** Rows of the log outside the snapshot. */
  updateCount(): number {
    return this.log.count;
  }

  /** Bytes in those rows. */
  updateBytes(): number {
    return this.log.bytes;
  }

  /** The sequence number the snapshot reaches to. */
  snapshotThroughSeq(): number {
    return this.snapshotThrough;
  }

  /** Rows currently sitting in `quarantined_updates`. */
  quarantinedCount(): number {
    return this.countRows('quarantined_updates');
  }

  /** How many rows the snapshot is spread over (0 when this board has none). */
  chunkRowCount(): number {
    return this.countRows('snapshot_chunks');
  }

  /**
   * Write one update. This is the only write in the path of a change, and it throws:
   * the room turns that into "this board could not be saved" (design key decision
   * 3), so a failure must not be swallowed here.
   */
  append(update: Uint8Array): void {
    this.ensureTables();
    this.exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, blob(update), update.byteLength);
    this.log.count += 1;
    this.log.bytes += update.byteLength;
  }

  /**
   * Read the board into `doc`: the snapshot, then the log rows after it.
   *
   * It never throws, and it never reports an empty board as if it were the truth: a
   * snapshot that cannot be decoded, or a read that fails, comes back `{ ok: false }`
   * for the room to turn into a load failure. A log row that cannot be decoded is
   * different in kind — one change out of thousands — so it is moved to
   * `quarantined_updates`, counted, and the rest of the board loads.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      if (this.presentTables().size === 0) {
        // No tables at all: this board was never made, and an empty document is the
        // truth about it rather than a lie. Nothing is created here — not the schema,
        // not a row — because reading a board that does not exist has to leave the
        // storage exactly as it found it, which is what "a bad link says Board not
        // found, and creates nothing" is made of.
        this.log = { count: 0, bytes: 0 };
        this.snapshotThrough = 0;
        return { ok: true, quarantined: 0 };
      }

      this.snapshotThrough = Number(this.metaGet(SNAPSHOT_THROUGH_SEQ_KEY) ?? '0');
      this.log = { count: 0, bytes: 0 };

      const snapshot = this.readSnapshot();
      if (snapshot !== null) {
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          // Most of the board is unreadable. Serving an empty board in its place
          // would be a lie, and writing over it would destroy what survives.
          return { ok: false, reason: 'snapshot-unreadable', error: messageOf(error) };
        }
      }

      let quarantined = 0;
      for (const row of this.rows<UpdateRow>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq ASC`,
        this.snapshotThrough,
      )) {
        try {
          Y.applyUpdate(doc, bytesOf(row.data), LOAD_ORIGIN);
          this.log.count += 1;
          this.log.bytes += row.bytes;
        } catch (error) {
          this.quarantine(row, messageOf(error));
          quarantined += 1;
        }
      }

      // A quarantined row leaves a hole its successors cannot step over; close it, so
      // the damage stops at the change that is actually damaged.
      this.closeHoles(doc);

      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: messageOf(error) };
    }
  }

  /**
   * Fold the log into the snapshot once it has grown past a threshold, in one
   * transaction: either the new snapshot and the truncated log both land, or neither
   * does. Returns false for a log below the threshold, and for a failure (after
   * rollback) — a board stays open through a compaction that did not work.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.log.count, this.log.bytes)) return false;
    return this.compactNow(doc);
  }

  /**
   * Fold the log into the snapshot now, whether or not the thresholds have been
   * reached. `compactIfNeeded` is what a board does to itself; this is the same
   * transaction on request, which is what a test needs to get a board into the
   * shape only a long board has — a snapshot whose damage matters.
   */
  compactNow(doc: Y.Doc): boolean {
    const before = { count: this.log.count, bytes: this.log.bytes };
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const through = this.maxUpdateSeq();
      const chunks = chunkBytes(encoded);
      this.transaction(() => {
        this.exec(`DELETE FROM snapshot_chunks`);
        for (const [index, chunk] of chunks.entries()) {
          this.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`, index, blob(chunk));
        }
        this.exec(`DELETE FROM updates WHERE seq <= ?`, through);
        this.metaSet(SNAPSHOT_THROUGH_SEQ_KEY, String(through));
      });
      this.log = { count: 0, bytes: 0 };
      this.snapshotThrough = through;
      return true;
    } catch (error) {
      // The transaction rolled the whole thing back: the snapshot and the log are
      // what they were. The log is still over the threshold, so the next change tries
      // again; until then the board pays for it in replay work, and the failure is on
      // the console.
      console.error('[board-store] compaction rolled back', {
        rows: before.count,
        bytes: before.bytes,
        error: messageOf(error),
      });
      return false;
    }
  }

  /* ------------------------------------------------------------------ internals */

  /**
   * One SQL statement that writes. Every statement in this file goes through here,
   * which is also the seam a test uses to make a write fail in the middle of a
   * transaction (TC-11) without pretending to be storage.
   */
  protected exec(sql: string, ...bindings: SqlValue[]): void {
    this.storage.sql.exec(sql, ...bindings);
  }

  /** One SQL statement that reads. */
  protected rows<T extends Record<string, SqlValue>>(sql: string, ...bindings: SqlValue[]): T[] {
    return this.storage.sql.exec<T>(sql, ...bindings).toArray();
  }

  /**
   * Which of this schema's tables the board actually has, read out of
   * `sqlite_master`. Once they are all there the answer is remembered, because every
   * read after that is on a board that exists; while they are missing nothing is
   * remembered, so an object that was constructed before `initialize()` built the
   * schema notices the moment it has one.
   */
  private presentTables(): Set<string> {
    if (this.tablesKnown) return new Set(TABLE_NAMES);
    const placeholders = TABLE_NAMES.map(() => '?').join(', ');
    const present = new Set(
      this.rows<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
        ...TABLE_NAMES,
      ).map((row) => row.name),
    );
    if (present.size === TABLE_NAMES.length) this.tablesKnown = true;
    return present;
  }

  /** Rows of one table, or 0 for a board that never had it. */
  private countRows(table: 'updates' | 'snapshot_chunks' | 'quarantined_updates', present = this.presentTables()): number {
    if (!present.has(table)) return 0;
    return this.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0;
  }

  /**
   * Make sure the schema is there before a write that needs it. This is the lazy half
   * of story 5's rule: a board made before `initialize()` existed still gets its
   * change written, and a board nobody is changing is never built by this call,
   * because nothing calls it for a board that has no change to write.
   */
  private ensureTables(): void {
    if (this.tablesKnown) return;
    this.migrate();
  }

  /**
   * Run `fn` as one transaction. If anything in it throws, the storage is back to
   * what it was before — that is what makes compaction safe to attempt.
   */
  protected transaction(fn: () => void): void {
    this.storage.transactionSync(fn);
  }

  /** Move one undecodable log row out of the log, keeping why it went. */
  private quarantine(row: UpdateRow, error: string): void {
    console.error('[board-store] quarantined log row', {
      seq: row.seq,
      bytes: row.bytes,
      error,
    });
    this.transaction(() => {
      this.exec(
        `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
        row.seq,
        row.data,
        error,
        Date.now(),
      );
      this.exec(`DELETE FROM updates WHERE seq = ?`, row.seq);
    });
  }

  /**
   * Close the clock gaps the quarantined rows left, so the rows behind them are
   * integrated rather than held for ever. Returns how many gaps were closed.
   */
  private closeHoles(doc: Y.Doc): number {
    let closed = 0;
    while (closed < CLOSE_HOLE_LIMIT) {
      const pending = pendingStructsOf(doc);
      if (pending === null) break;
      const fill = gapFillUpdate(Y.encodeStateVector(doc), pending.missing);
      if (fill === null) break;
      try {
        Y.applyUpdate(doc, fill, LOAD_ORIGIN);
      } catch (error) {
        // The hole stays open. The rows behind it are not lost — Yjs is holding them
        // and the log still holds them too — so the next load gets another try.
        console.error('[board-store] could not close a gap in the log', {
          error: messageOf(error),
        });
        break;
      }
      closed += 1;
    }
    if (closed >= CLOSE_HOLE_LIMIT) {
      console.error('[board-store] gave up closing gaps in the log', { gaps: closed });
    } else if (closed > 0) {
      console.error('[board-store] closed gaps left by quarantined rows', { gaps: closed });
    }
    return closed;
  }

  /** The encoded snapshot in one piece, or null when this board has none. */
  private readSnapshot(): Uint8Array | null {
    const chunks = this.rows<ChunkRow>(`SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC`);
    if (chunks.length === 0) return null;
    return joinChunks(chunks.map((chunk) => bytesOf(chunk.data)));
  }

  /** The newest sequence number in the log (0 when the log is empty). */
  private maxUpdateSeq(): number {
    return this.rows<MaxSeqRow>(`SELECT MAX(seq) AS seq FROM updates`)[0]?.seq ?? 0;
  }

  /** One `storage_meta` value, or null when the key is not there. */
  private metaGet(key: string): string | null {
    return this.rows<MetaRow>(`SELECT value FROM storage_meta WHERE key = ?`, key)[0]?.value ?? null;
  }

  /** Write one `storage_meta` value, replacing whatever was there. */
  private metaSet(key: string, value: string): void {
    this.exec(
      `INSERT INTO storage_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}
