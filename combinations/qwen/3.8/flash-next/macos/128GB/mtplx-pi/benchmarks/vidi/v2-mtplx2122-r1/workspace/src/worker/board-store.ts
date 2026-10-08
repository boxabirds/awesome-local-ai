/**
 * BoardStore: the SQLite side of board persistence (story 4, `persist.board_store`)
 * and, from story 5, the place that answers "does this board exist?"
 * (`share.not_found`).
 *
 * Layout of one board's database (one database per Durable Object, therefore
 * per board):
 *
 * - `storage_meta`         — `storage_schema_version`, `snapshot_through_seq`,
 *                            `created_at` (the existence marker, story 5)
 * - `updates`              — the append-only log, one row per Yjs update
 * - `snapshot_chunks`      — the compacted document, split into fixed-size rows
 * - `quarantined_updates`  — log rows that could not be applied any more
 *
 * Loading replays the snapshot and then every log row above
 * `snapshot_through_seq`, so the work done on wake is bounded by compaction
 * rather than by the age of the board. The three pure functions at the top
 * (chunking and the compaction threshold) hold the arithmetic that decides
 * *when* and *how* that replay is bounded, and are unit-tested without any
 * database (TC-01, TC-02).
 *
 * Story 5 added one rule on top of that: reading must not write. A board that
 * was never created has no tables at all, and neither `load()` nor
 * `existsReadOnly()` creates them — otherwise every mistyped link in the world
 * would leave a database behind, and "Board not found" would be a lie.
 */

import * as Y from 'yjs'
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config'

/** Origin tag for bytes that came out of storage: never stored or broadcast again. */
export const LOAD_ORIGIN: unique symbol = Symbol('load')

/**
 * `storage_meta` key marking a board as one that was deliberately created
 * (`POST /api/boards`). Its absence used to mean "nobody ever edited this
 * board"; from story 5 it means "this address was never granted", which is why
 * boards that already have saved content still count as existing without it.
 */
export const CREATED_AT_KEY = 'created_at'

/** Our four tables, in creation order (`sqlite_master` probe). */
const BOARD_TABLES = ['storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates'] as const

/** Split `data` into chunks of at most `size` bytes (0 bytes → 0 chunks). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size < 1) throw new Error(`chunk size must be positive, got ${size}`)
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < data.byteLength; offset += size) {
    // `slice` copies: a chunk is a standalone buffer, never a window onto the
    // encoded snapshot, so a later `joinChunks` cannot be corrupted by it.
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)))
  }
  return chunks
}

/** Concatenate chunks back into one buffer (the chunks are copied, not aliased). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Compact when either threshold is reached (boundary values are inclusive). */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES
}

export type LoadFailureReason = 'snapshot-unreadable' | 'log-unreadable' | 'sql-error'

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: LoadFailureReason; error: string; quarantined?: number }

export interface SqlCursorLike<T extends Record<string, unknown>> extends Iterable<T> {
  toArray(): T[]
}

/** The part of `DurableObjectStorage` this class touches. */
export interface SqlStorageLike {
  exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursorLike<T>
}

export interface StorageLike {
  sql: SqlStorageLike
  transactionSync<T>(closure: () => T): T
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A BLOB column comes back as an `ArrayBuffer` in some runtimes and as a
 * `Uint8Array` in others. Yjs needs the view; `joinChunks` would silently
 * copy nothing from a bare buffer, so normalise before applying.
 */
export function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

export class BoardStore {
  #storage: StorageLike
  #throughSeq = 0
  #logCount = 0
  #logBytes = 0
  #maxSeq = 0
  #migrated = false

  constructor(storage: StorageLike) {
    this.#storage = storage
  }

  /** In-memory mirror of the log, kept so no write needs a `COUNT(*)`. */
  get logStats(): { count: number; bytes: number; throughSeq: number; maxSeq: number } {
    return {
      count: this.#logCount,
      bytes: this.#logBytes,
      throughSeq: this.#throughSeq,
      maxSeq: this.#maxSeq,
    }
  }

  /** For tests: replace the mirror with what is on disk. */
  setLogStats(count: number, bytes: number, throughSeq = this.#throughSeq, maxSeq = this.#maxSeq): void {
    this.#logCount = count
    this.#logBytes = bytes
    this.#throughSeq = throughSeq
    this.#maxSeq = maxSeq
  }

  // ── schema ─────────────────────────────────────────────────────────────────

  /**
   * True when all four tables exist.
   *
   * This is the *only* thing read for a board nobody ever created, and it is
   * a read: `sqlite_master` is queried rather than `CREATE TABLE IF NOT
   * EXISTS` run, because story 5 requires that probing an unknown link leaves
   * no storage behind (TC-06, TC-09).
   */
  #tablesExist(): boolean {
    for (const table of BOARD_TABLES) {
      const found = this.#storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          table,
        )
        .toArray()
      if (found.length === 0) return false
    }
    return true
  }

  /**
   * Read-only existence check (story 5, `share.not_found`).
   *
   * A board exists when it was granted by `POST /api/boards` — that writes
   * `created_at` — *or* when it already has content from an earlier story
   * (`share.legacy_boards`: boards created by the story 3 client redirect have
   * update rows and no `created_at`, and opening one of those links must keep
   * working). Everything else, including a well-formed id nobody ever asked
   * for, answers "does not exist" without writing anything.
   */
  existsReadOnly(): boolean {
    const sql = this.#storage.sql
    try {
      if (!this.#tablesExist()) return false
      if (this.metaValue(CREATED_AT_KEY) !== null) return true
      // Legacy board: content is existence.
      if (sql.exec<{ some: number }>('SELECT 1 AS some FROM updates LIMIT 1').toArray().length > 0) {
        return true
      }
      if (sql.exec<{ some: number }>('SELECT 1 AS some FROM snapshot_chunks LIMIT 1').toArray().length > 0) {
        return true
      }
      return false
    } catch (error) {
      // A database we cannot read is not a board anyone can open; reporting it
      // as absent only hides damage that `load()` will log in detail.
      console.error(`[board-store] existence check failed: ${messageOf(error)}`)
      return false
    }
  }

  /**
   * Create the tables and record the schema version.
   *
   * Called from `BoardRoom.initialize()` (one new board, granted through
   * `POST /api/boards`) and lazily before the first `append()`, never on
   * construct and never from `load()`.
   *
   * Deliberately writes no `updates` or `snapshot_chunks` rows: opening a
   * board that was never edited must not create board content (TC-25).
   */
  migrate(): void {
    if (this.#migrated) return
    const sql = this.#storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    )
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    )
    sql.exec(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      'storage_schema_version',
      String(STORAGE_SCHEMA_VERSION),
    )
    this.#migrated = true
  }

  /**
   * Record the existence marker. Returns `created` the first time a board is
   * initialised and `exists` on every later call (TC-15), which is also what
   * keeps a colliding id from ever being shared with a second board.
   */
  initialize(now: number): 'created' | 'exists' {
    const alreadyThere = this.#tablesExist()
    this.migrate()
    if (this.metaValue(CREATED_AT_KEY) !== null) return 'exists'
    this.#storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
      CREATED_AT_KEY,
      String(now),
    )
    // A legacy board (content, no marker) was already a board; initialising it
    // does not create it, and the marker must not pretend otherwise.
    return alreadyThere ? 'exists' : 'created'
  }

  /** Read a meta key (mostly for tests and the schema-version assertion). */
  metaValue(key: string): string | null {
    for (const row of this.#storage.sql.exec<{ key: string; value: string }>(
      'SELECT value FROM storage_meta WHERE key = ?',
      key,
    )) {
      return row.value
    }
    return null
  }

  // ── append ─────────────────────────────────────────────────────────────────

  /**
   * Store one update. SQL errors are rethrown: the caller resets the room,
   * because an update nobody else may see until it is durable is a change the
   * room cannot serve half-saved (persist.seen_is_saved).
   */
  append(update: Uint8Array): void {
    // Lazily build the schema here: story 3 clients could open a board without
    // ever asking for one, so a board's first write may still be its first
    // contact with storage. From story 5 a connection alone is not that write.
    this.migrate()
    const sql = this.#storage.sql
    // The sequence number is supplied rather than left to AUTOINCREMENT so it
    // keeps counting across a compaction: a fresh log must start *above*
    // `snapshot_through_seq`, which is what `load` filters on.
    const seq = this.#maxSeq + 1
    sql.exec('INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)', seq, update, update.byteLength)
    this.#maxSeq = seq
    this.#logCount += 1
    this.#logBytes += update.byteLength
  }

  // ── load ───────────────────────────────────────────────────────────────────

  /**
   * Rebuild `doc` from storage.
   *
   * A row that Yjs cannot read is moved out of the log into
   * `quarantined_updates`, so the same corruption does not fail on every wake.
   * It does *not* mean the rest of the chain still loads: Yjs silently drops an
   * update whose dependencies are missing, so a hole in the log swallows every
   * later row that referenced it (measured: one damaged row out of 75 leaves a
   * two-note board). Serving that would look like the board lost its notes, and
   * the next compaction would make the loss permanent. So the replay stops at
   * the hole and reports `ok: false`: the room discards the half-read doc and
   * shows the load-failure state instead (design, "Errors").
   *
   * The same reasoning keeps snapshot damage fatal and keeps snapshot chunks
   * out of the quarantine: deleting either would destroy the readable copy.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.#tablesExist()) {
        // Never-created board: an empty document, and no tables written while
        // finding that out. This is the read that a mistyped link triggers
        // thousands of times a day; it must cost nothing and change nothing.
        this.#migrated = false
        return { ok: true, quarantined: 0 }
      }
      // The schema is already there (story 4 board, or one we created):
      // nothing in this method needs to create it again.
      this.#migrated = true

      const throughRow = this.metaValue('snapshot_through_seq')
      this.#throughSeq = throughRow === null ? 0 : Number(throughRow)

      const chunks: Uint8Array[] = []
      for (const row of this.#storage.sql.exec<{ idx: number; data: Uint8Array | ArrayBuffer }>(
        'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
      )) {
        chunks.push(asBytes(row.data))
      }

      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN)
        } catch (error) {
          // Nothing is deleted and nothing is quarantined: the snapshot stays
          // exactly as it is so a repair can still load it (TC-10).
          return { ok: false, reason: 'snapshot-unreadable', error: messageOf(error) }
        }
      }

      let count = 0
      let bytes = 0
      let maxSeq = this.#throughSeq
      let quarantined = 0
      const storage = this.#storage

      const rows = [
        ...storage.sql.exec<{ seq: number; data: Uint8Array | ArrayBuffer }>(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          this.#throughSeq,
        ),
      ].map(row => ({ seq: row.seq, data: asBytes(row.data) }))

      for (const row of rows) {
        // Every row visited raises the high-water mark, whether it applied or
        // was quarantined: the next append must not reuse its sequence number.
        maxSeq = Math.max(maxSeq, row.seq)
        try {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN)
          count += 1
          bytes += row.data.byteLength
        } catch (error) {
          // A row that Yjs cannot read will never become readable: move it out
          // of the log so the next wake does not repeat the failure, and stop
          // here because everything after it may depend on it.
          try {
            storage.transactionSync(() => {
              storage.sql.exec(
                'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
                row.seq,
                row.data,
                messageOf(error),
                Date.now(),
              )
              storage.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq)
            })
            quarantined += 1
          } catch (inner) {
            return { ok: false, reason: 'sql-error', error: `${messageOf(error)} / ${messageOf(inner)}` }
          }
          console.error(
            `[board-store] quarantined update ${row.seq} of this board: ${messageOf(error)}`,
          )
          return {
            ok: false,
            reason: 'log-unreadable',
            error: messageOf(error),
            quarantined,
          }
        }
      }

      this.#logCount = count
      this.#logBytes = bytes
      this.#maxSeq = maxSeq
      return { ok: true, quarantined }
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: messageOf(error) }
    }
  }

  // ── compaction ─────────────────────────────────────────────────────────────

  /**
   * Fold the log into a fresh snapshot inside one transaction.
   *
   * Never throws: a failure rolls the transaction back (previous snapshot and
   * log intact) and returns false, so the board keeps working on a longer log.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.#logCount, this.#logBytes)) return false
    const maxSeq = this.#maxSeq
    if (maxSeq <= 0) return false

    const encoded = Y.encodeStateAsUpdate(doc)
    const chunks = chunkBytes(encoded)
    const storage = this.#storage

    try {
      storage.transactionSync(() => {
        storage.sql.exec('DELETE FROM snapshot_chunks')
        for (let idx = 0; idx < chunks.length; idx++) {
          storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunks[idx])
        }
        storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq)
        storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          String(maxSeq),
        )
      })
    } catch (error) {
      // Rolled back by transactionSync: the old snapshot and the whole log are
      // still there, so the next load replays a slightly longer log.
      console.error(`[board-store] compaction rolled back: ${messageOf(error)}`)
      return false
    }

    this.#throughSeq = maxSeq
    this.#logCount = 0
    this.#logBytes = 0
    return true
  }

  /** True while the log is short enough to replay directly. */
  get needsCompaction(): boolean {
    return shouldCompact(this.#logCount, this.#logBytes)
  }
}
