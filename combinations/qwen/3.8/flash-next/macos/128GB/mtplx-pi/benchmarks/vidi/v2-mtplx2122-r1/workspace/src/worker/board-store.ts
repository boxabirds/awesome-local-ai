/**
 * BoardStore: the SQLite side of board persistence (story 4, `persist.board_store`).
 *
 * Layout of one board's database (one database per Durable Object, therefore
 * per board):
 *
 * - `storage_meta`         — `storage_schema_version`, `snapshot_through_seq`
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
   * Create the tables and record the schema version.
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
      this.migrate()

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
