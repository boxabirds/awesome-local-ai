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
export const STATE_TABLE = 'board_blobs';

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

  #fail: FailureMode = 'none';

  #delayMs = 0;

  constructor(
    private readonly sql: SqlStorage | undefined,
    options: { chunkBytes?: number } = {},
  ) {
    this.#chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (this.sql === undefined) {
      throw new Error(
        'RoomStore needs the object storage SQLite API; `ctx.storage.sql` is missing',
      );
    }
    this.#prepare();
  }

  /**
   * One statement, run once per instance, before anything reads.
   *
   * `IF NOT EXISTS` rather than "assume the migration ran": a test worker and a
   * deployed worker both land here with a database nobody prepared, and the first
   * read of a board must not depend on somebody else having run a migration by
   * hand.
   */
  #prepare(): void {
    this.sql!.exec(
      `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (` +
        'board_id TEXT NOT NULL, ' +
        'chunk INTEGER NOT NULL, ' +
        'blob BLOB NOT NULL, ' +
        'PRIMARY KEY (board_id, chunk))',
    );
  }

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
