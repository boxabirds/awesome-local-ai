import type { SqlStorage } from '@cloudflare/workers-types/experimental';

/**
 * Where a board's bytes live: one SQLite table in the object's own storage.
 *
 *     board_blobs(board_id TEXT, chunk INTEGER, blob BLOB)
 *
 * Nothing about the shape here is decorative:
 *
 * - **A board bigger than one row is split.** A single SQLite row is capped at
 *   about 400 KB; a large board is many megabytes. So the state goes in as a
 *   sequence of chunks keyed `(board_id, chunk)`, and the read glues them back.
 * - **A read that does not produce a whole version-3 state is damage, not an
 *   empty board.** The version byte is written with the state and checked on the
 *   way back in. Anything shorter than that, or starting with a different byte,
 *   comes back as {@link STATE_UNREADABLE}.
 * - **A damaged state is never loaded as an empty board.** The room's answer to
 *   `STATE_UNREADABLE` is to refuse the connection; its answer to `null` is to
 *   start a fresh board. Conflating them is the bug that hands a returning editor
 *   a board that looks empty.
 *
 * The API is `exec`, not `read`: in this runtime `SqlStorage` exposes `exec`
 * returning a cursor, `prepare`, `ingest` and `databaseSize`, and iterating a
 * cursor is how a query gets read. Everything here is synchronous, which is what
 * lets a cold arrival answer straight from storage without a second hop to a room
 * that is already awake — and what makes "the load happens before the answer" a
 * property of the code rather than of the scheduler.
 */
/** Where the board's bytes live. */
export const STATE_TABLE = 'board_blobs';

/**
 * Where a board's own facts live, one row per fact.
 *
 * `created_at` is written once, by an explicit create, and it is what makes a
 * board *exist* rather than merely *have bytes*. Story 4's storage predates the
 * idea, so a board with bytes but no `created_at` is a legacy board: it still
 * opens, because somebody's work is in there (PRD share.legacy_boards).
 */
export const META_TABLE = 'storage_meta';

/** The meta key that marks a board as created. */
export const CREATED_AT_KEY = 'created_at';

/** The tables a prepared database has. Order matters for {@link migrate}. */
const TABLES = [STATE_TABLE, META_TABLE];

/**
 * Whether a table exists, read straight out of `sqlite_master`.
 *
 * This is the only way to ask "has anybody ever made a board here?" without
 * answering it. `CREATE TABLE IF NOT EXISTS` also says "no", and then leaves a
 * pair of empty tables behind — so probing a mistyped link would write storage
 * for a board that does not exist. Reading the schema is how that is kept apart.
 */
export function hasTable(sql: SqlStorage, name: string): boolean {
  return (
    sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`, name)
      .toArray().length > 0
  );
}

/** The statements that prepare a database. Run together, never one at a time. */
export function migrationSql(): string {
  return (
    `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (` +
    'board_id TEXT NOT NULL, '
    + 'chunk INTEGER NOT NULL, '
    + 'blob BLOB NOT NULL, '
    + 'PRIMARY KEY (board_id, chunk)); '
    + `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );
}

/** One row's worth of bytes. SQLite's own limit is 400 000; we stay under it. */
export const DEFAULT_CHUNK_BYTES = 96 * 1024;

/** What a complete state's first byte has to be. Anything else is damage. */
export const STATE_VERSION = 3;

/** Not a board. Distinct from "nothing stored yet", and from a `Uint8Array`. */
export const STATE_UNREADABLE = Symbol('state-unreadable');

/** What {@link RoomStore.read} answers: bytes, "nothing yet", or "damaged". */
export type LoadResult = Uint8Array | typeof STATE_UNREADABLE | null;

/** How the room's fault injection makes a read behave. */
export type FailureMode = 'none' | 'unreadable' | 'timeout' | 'throw';

/** How much room a board is taking, for the tests and for the console. */
export type BoardFootprint = { bytes: number; chunks: number; largest: number };

/** Split a state into row-sized chunks, prefixed with the version byte. */
export function splitState(
  bytes: Uint8Array,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): Uint8Array[] {
  const stream = new Uint8Array(bytes.byteLength + 1);
  stream[0] = STATE_VERSION;
  stream.set(bytes, 1);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < stream.byteLength; offset += chunkBytes) {
    chunks.push(stream.subarray(offset, Math.min(offset + chunkBytes, stream.byteLength)));
  }
  return chunks;
}

/**
 * Glue chunks back together.
 *
 * `null` means nothing was stored; {@link STATE_UNREADABLE} means something was
 * stored and it is not a state. The distinction is the whole point of the
 * function, so no caller ever has to guess which one it is holding.
 */
export function joinState(chunks: Uint8Array[] | undefined): LoadResult {
  if (chunks === undefined || chunks.length === 0) return null;
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  // A state is a version byte plus the bytes of a lib0 encoding: anything under
  // two bytes cannot be one, whatever else it turns out to be.
  if (total < 2) return STATE_UNREADABLE;
  const stream = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    stream.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (stream[0] !== STATE_VERSION) return STATE_UNREADABLE;
  return stream.subarray(1);
}

/** Copy bytes out of SQLite's `ArrayBuffer` into a fresh buffer. */
function copyFrom(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

/** The room's board storage. One instance per hibernating room. */
export class RoomStore {
  #chunkBytes: number;

  /** Whether this object's database has its tables. See {@link migrate}. */
  #prepared: boolean;

  #fail: FailureMode = 'none';

  #delayMs = 0;

  constructor(
    private readonly sql: SqlStorage | undefined,
    options: { chunkBytes?: number } = {},
  ) {
    this.#chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    // Whether the tables exist is read from the database, not assumed. A fresh
    // object and a woken one land here the same way, and only the woken one has
    // tables; `#prepared` is the difference between them.
    this.#prepared = hasTable(this.sql!, STATE_TABLE) && hasTable(this.sql!, META_TABLE);
    void this.#prepared;
  }

  /**
   * Prepare the database, if it is not prepared.
   *
   * Called by an explicit create, and lazily before the first write. Not called
   * by the constructor and not called by a read: an unknown id must leave no
   * tables behind, which is the only way "probing a link wrote nothing" is true.
   */
  migrate(): void {
    if (this.#prepared) return;
    this.sql!.exec(migrationSql());
    this.#prepared = true;
  }

  /** Whether this board has anywhere to keep bytes yet. */
  get prepared(): boolean {
    return this.#prepared;
  }

  /**
   * Does this board exist? Reads only, and creates nothing.
   *
   * Two answers count as existing, for different reasons: a `created_at`, which
   * is a board somebody made on purpose; and any stored bytes at all, which is a
   * board made before `created_at` existed. Everything else is "no", including an
   * id whose tables were never made — and the schema is looked at first precisely
   * so that the common case, a mistyped link, costs one cheap lookup.
   */
  existsReadOnly(boardId: string): boolean {
    if (!hasTable(this.sql!, STATE_TABLE)) return false;
    if (this.#created_at()) return true;
    const rows = this.sql!
      .exec(`SELECT 1 FROM ${STATE_TABLE} WHERE board_id = ?1 LIMIT 1`, boardId)
      .toArray();
    return rows.length > 0;
  }

  /** This board's `created_at`, or `undefined` if it was never created. */
  createdAt(): string | undefined {
    return this.#created_at();
  }

  /** Does this board exist? The room's own answer, for the room's own tests. */
  exists(boardId: string): boolean {
    return this.existsReadOnly(boardId);
  }
  #created_at(): string | undefined {
    if (!hasTable(this.sql!, META_TABLE)) return undefined;
    const row = this.sql!
      .exec(`SELECT value FROM ${META_TABLE} WHERE key = ?1`, CREATED_AT_KEY)
      .toArray()[0];
    return row === undefined ? undefined : (row.value as string);
  }

  /**
   * Mark this board as created, keeping the original stamp.
   * `true` if this call is what created it, `false` if it already was.
   */
  markCreated(boardId: string, at: number): boolean {
    // Storage that cannot be trusted does not get a board written to it. This
    // keeps "the storage is broken" arriving at the room as a failure rather
    // than as a successful create of a board nobody can read back.
    if (this.#fail === 'throw') throw new Error('storage write threw');
    const already = this.#created_at();
    if (already !== undefined) return false;
    this.migrate();
    this.sql!.exec(
      `INSERT INTO ${META_TABLE} (key, value) VALUES (?1, ?2)`,
      CREATED_AT_KEY,
      String(at),
    );
    return true;
  }

  /**
   * One statement, run before anything is *written*.
   *
   * `IF NOT EXISTS` rather than "assume the migration ran": a test worker and a
   * deployed worker both land here with a database nobody prepared. It is not run
   * on construct and not run on a read, because doing so would answer "does this
   * board exist?" by making tables, which makes every probe of a mistyped link
   * write storage.
   */

  /** Test hook: make the next reads behave as if storage were broken. */
  failAs(mode: FailureMode, delayMs = 0): void {
    this.#fail = mode;
    this.#delayMs = delayMs;
  }

  /**
   * Read a board's bytes.
   *
   * Blocks the isolate — by design, and with a cost the room has to respect: a
   * wedged storage read stops everything else this instance is doing, which is
   * why the caller keeps a deadline and treats "late" the same as "damaged".
   */
  read(boardId: string): LoadResult {
    if (this.#fail === 'throw') throw new Error('storage read threw');
    // No tables means no board, and this answers before running a real query, so
    // a stranger's mistyped link cannot manufacture a database. `null` is
    // deliberately the same answer a prepared-but-empty board gives: story 4's
    // room starts a fresh board from `null`, and story 5 refuses it separately.
    if (!this.#prepared) return null;
    if (this.#fail === 'timeout') {
      // Burn the clock so the room's deadline is what notices, then refuse.
      this.#burn(this.#delayMs);
      return STATE_UNREADABLE;
    }

    const rows = this.sql!
      .exec(
        `SELECT chunk, blob FROM ${STATE_TABLE} WHERE board_id = ?1 ORDER BY chunk`,
        boardId,
      )
      .toArray();

    if (this.#fail === 'unreadable') return STATE_UNREADABLE;
    if (rows.length === 0) return null;

    const joined = joinState(rows.map((row) => copyFrom(row.blob as ArrayBuffer)));
    if (joined === STATE_UNREADABLE) {
      console.warn(`board ${boardId}: the stored state is unreadable, refusing to load it`);
    }
    return joined;
  }

  /** Replace everything stored for a board. */
  write(boardId: string, bytes: Uint8Array): void {
    if (this.#fail === 'throw') throw new Error('storage write threw');
    // The write is the first place a board is allowed to prepare its database.
    this.migrate();
    const chunks = splitState(bytes, this.#chunkBytes);
    // Delete first: a board that shrank must not keep the tail of its old bytes,
    // which would come back glued on to the end of the new state.
    this.sql!.exec(`DELETE FROM ${STATE_TABLE} WHERE board_id = ?1`, boardId);
    for (const [chunk, blob] of chunks.entries()) {
      this.sql!.exec(
        `INSERT INTO ${STATE_TABLE} (board_id, chunk, blob) VALUES (?1, ?2, ?3)`,
        boardId,
        chunk,
        blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
      );
    }
  }

  /** How much room a board is taking, chunk by chunk. */
  footprint(boardId: string): BoardFootprint {
    if (!this.#prepared) return { bytes: 0, chunks: 0, largest: 0 };
    const rows = this.sql!
      .exec(`SELECT blob FROM ${STATE_TABLE} WHERE board_id = ?1`, boardId)
      .toArray();
    let bytes = 0;
    let largest = 0;
    for (const row of rows) {
      const size = (row.blob as ArrayBuffer).byteLength;
      bytes += size;
      largest = Math.max(largest, size);
    }
    return { bytes, chunks: rows.length, largest };
  }

  /** Write raw bytes with no version byte. Test-only: it manufactures damage. */
  writeDamaged(boardId: string, bytes: Uint8Array): void {
    this.migrate();
    this.sql!.exec(`DELETE FROM ${STATE_TABLE} WHERE board_id = ?1`, boardId);
    this.sql!.exec(
      `INSERT INTO ${STATE_TABLE} (board_id, chunk, blob) VALUES (?1, 0, ?2)`,
      boardId,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }

  #burn(ms: number): void {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* spin: a wedged storage read is synchronous, so the test has to be too */
    }
  }
}
