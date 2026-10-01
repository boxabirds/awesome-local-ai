// One board's SQLite storage: the schema, the update log, the chunked snapshot
// and the quarantine for damaged rows. It is the whole of `persist.board_store`.
//
// The design leans on one platform fact: a Durable Object's SQLite calls are
// synchronous and the runtime holds a room's outgoing WebSocket frames until its
// pending storage writes are confirmed. So the room can write a change here and
// then broadcast it in the same turn, and no other client ever sees a change
// that is not durably stored (persist.seen_is_saved). That guarantee is not
// reimplemented here, only relied upon; see the design's "Not covered".
//
// What lives in which table:
//   storage_meta        the storage schema version, and the log sequence the
//                       current snapshot already contains.
//   updates             the append-only log of Yjs updates, one row each.
//   snapshot_chunks     the compacted document, encoded once and split so every
//                       row stays well under the platform's per-row size limit.
//   quarantined_updates a log row Yjs could not read on load, moved aside so the
//                       rest of the board still opens (persist.partial_damage).
import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../shared/snapshot-chunks';

// The chunking and compaction helpers are pure and live in `shared` (so a plain
// unit test can import them without the Workers globals); they are re-exported here
// so the storage module's callers and its integration test address them as before.
export { chunkBytes, joinChunks, shouldCompact };

/** The origin every update applied from storage carries. The room skips
 *  storing or broadcasting an update it sees with this origin, so a reload
 *  neither writes the board back to itself nor echoes it to sockets. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** Why a board could not be read, or how much of it had to be left behind. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** One row of the update log, as `load` reads it back.
 * (Type aliases, not interfaces: `SqlStorage.exec<T>` needs `T` to satisfy
 * `Record<string, SqlStorageValue>`, and only an object type alias gets the
 * implicit index signature that an interface does not.) */
type UpdateRow = { seq: number; data: ArrayBuffer };

/** A row of `storage_meta`. */
type MetaRow = { value: string };

/** A row of `snapshot_chunks`. */
type ChunkRow = { data: ArrayBuffer };

/** A row that carries a byte total. */
type BytesRow = { total: number | null };

/**
 * A board's storage, held by one BoardRoom for as long as it is awake. Every
 * method is synchronous: SQLite in a Durable Object is, and the room writes a
 * change and broadcasts it in one turn.
 *
 * The row count and byte total of the log are kept in memory after `load` so a
 * write never has to run a `COUNT(*)` first (the compaction decision and the
 * open-time budget both depend on writes staying cheap).
 */
export class BoardStore {
  private readonly sql: SqlStorage;
  private readonly transactionSync: <T>(closure: () => T) => T;

  /** Log rows with a sequence above `throughSeq`, and their bytes. */
  private logCount = 0;
  private logBytes = 0;
  /** The highest log sequence the snapshot already contains (0 for none). */
  private throughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.sql = storage.sql;
    this.transactionSync = storage.transactionSync.bind(storage);
  }

  /** Create the tables. Writes no update rows, ever (TC-25). */
  migrate(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    const present = this.sql.exec<MetaRow>('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version').toArray();
    if (present.length === 0) {
      this.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /** Append one update to the log. A SQL failure is rethrown: the room resets. */
  append(update: Uint8Array): void {
    // A view over a shared buffer must not be handed over as a detached one.
    const bytes = update.slice();
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', bytes, bytes.length);
    this.logCount += 1;
    this.logBytes += bytes.length;
  }

  /** Apply the snapshot and then the log to `doc`.
   *
   * A damaged log row is moved to the quarantine and the rest still loads
   * (`ok: true` with a `quarantined` count). A snapshot that cannot be read, or
   * a SQL failure anywhere, is `ok: false`: the room then refuses to serve an
   * empty board (persist.load_failure). Nothing is deleted or quarantined when
   * the snapshot is the thing that is broken (TC-10).
   */
  load(doc: Y.Doc): LoadResult {
    let snapshot: Uint8Array | null;
    let rows: UpdateRow[];
    try {
      snapshot = this.readSnapshot();
      const through = this.sql
        .exec<MetaRow>('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .toArray();
      this.throughSeq = through.length > 0 ? Number(through[0]!.value) : 0;
      // Read the whole log slice before writing anything: a SQLite cursor holds
      // the database open for writing until it is consumed.
      rows = this.sql
        .exec<UpdateRow>('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', this.throughSeq)
        .toArray();
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: messageOf(error) };
    }

    if (snapshot !== null) {
      try {
        Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
      } catch (error) {
        // Most of the board is unreadable: say so rather than open an empty one.
        return { ok: false, reason: 'snapshot-unreadable', error: messageOf(error) };
      }
    }

    let quarantined = 0;
    let appliedBytes = 0;
    for (const row of rows) {
      try {
        Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
        appliedBytes += row.data.byteLength;
      } catch (error) {
        this.quarantine(row.seq, row.data, messageOf(error));
        quarantined += 1;
      }
    }

    // The counters describe what is left in the log, not what was read: a row
    // that had to go is no longer one the next write has to replay.
    this.logCount = rows.length - quarantined;
    this.logBytes = appliedBytes;
    return { ok: true, quarantined };
  }

  /** Fold the log into the snapshot when a threshold is reached.
   *
   * It never throws: a failure is logged, the transaction is rolled back (the
   * previous snapshot and the whole log stay exactly as they were) and `false`
   * comes back. `Y.encodeStateAsUpdate` is taken from the in-memory document,
   * which already holds snapshot plus log, so the next load replays at most one
   * snapshot and fewer than `COMPACTION_UPDATE_COUNT` rows.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /** Compact whatever is in the log, thresholds aside. Only the room's own
   *  test hook uses this: a real board compacts on its thresholds alone. */
  compactNow(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  /** Rows in the log, for tests that must look at the stored state. */
  countUpdates(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates').toArray()[0]!.n;
  }

  /** Chunks in the snapshot, for tests that must look at the stored state. */
  countChunks(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0]!.n;
  }

  /** Rows set aside as unreadable, for tests. */
  countQuarantined(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM quarantined_updates').toArray()[0]!.n;
  }

  // --- test-only (the room's own hooks reach these) --------------------------
  // An end-to-end test has no broken disk to wait for, so the room's hooks use
  // these to put a board into, and out of, the unreadable-snapshot state.

  /** The bytes of one snapshot chunk, or null if there is no such chunk. */
  testReadChunk(idx: number): Uint8Array | null {
    const rows = this.sql.exec<ChunkRow>('SELECT data FROM snapshot_chunks WHERE idx = ?', idx).toArray();
    return rows.length > 0 ? new Uint8Array(rows[0]!.data) : null;
  }

  /** Write over one snapshot chunk (used to replace a good chunk with garbage). */
  testWriteChunk(idx: number, data: Uint8Array): void {
    this.sql.exec(
      'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?) ON CONFLICT(idx) DO UPDATE SET data = excluded.data',
      idx,
      data.slice(),
    );
  }

  /** Keep a copy of a chunk's bytes so they can be put back. */
  testSaveChunk(idx: number, data: Uint8Array): void {
    this.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `__test_chunk_${idx}`,
      encodeBase64(data),
    );
  }

  /** Restore a chunk saved by `testSaveChunk`; false if nothing was saved. */
  testRestoreChunk(idx: number): boolean {
    const rows = this.sql
      .exec<MetaRow>('SELECT value FROM storage_meta WHERE key = ?', `__test_chunk_${idx}`)
      .toArray();
    if (rows.length === 0) return false;
    this.testWriteChunk(idx, decodeBase64(rows[0]!.value));
    this.sql.exec('DELETE FROM storage_meta WHERE key = ?', `__test_chunk_${idx}`);
    return true;
  }

  /** The stored log byte for one sequence, for tests. */
  updateBytes(seq: number): number | null {
    const rows = this.sql.exec<BytesRow>('SELECT bytes AS total FROM updates WHERE seq = ?', seq).toArray();
    return rows.length > 0 ? rows[0]!.total : null;
  }

  // --- internals -------------------------------------------------------------

  private compact(doc: Y.Doc): boolean {
    let encoded: Uint8Array;
    try {
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error('vidi6: compaction could not encode the document', messageOf(error));
      return false;
    }
    const chunks = chunkBytes(encoded);
    const lastSeq = this.maxLogSeq();
    try {
      this.transactionSync(() => {
        this.sql.exec('DELETE FROM snapshot_chunks');
        for (let idx = 0; idx < chunks.length; idx++) {
          // Each chunk is copied into a buffer of its own: `chunkBytes` returns
          // views over one encoding, and a view of a view is not a storable blob.
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunks[idx]!.slice());
        }
        if (lastSeq > 0) this.sql.exec('DELETE FROM updates WHERE seq <= ?', lastSeq);
        this.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          String(lastSeq),
        );
      });
    } catch (error) {
      // The rollback above already undid every statement, so the board is left
      // with its previous snapshot and its whole log.
      console.error('vidi6: compaction failed and was rolled back', messageOf(error));
      return false;
    }
    this.throughSeq = lastSeq;
    this.logCount = 0;
    this.logBytes = 0;
    return true;
  }

  private readSnapshot(): Uint8Array | null {
    const rows = this.sql.exec<ChunkRow>('SELECT data FROM snapshot_chunks ORDER BY idx').toArray();
    if (rows.length === 0) return null;
    return joinChunks(rows.map((row) => new Uint8Array(row.data)));
  }

  private quarantine(seq: number, data: ArrayBuffer, error: string): void {
    try {
      this.transactionSync(() => {
        this.sql.exec(
          'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data,
          error,
          Date.now(),
        );
        this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      });
    } catch (failure) {
      // A row that cannot be read and cannot be moved aside is left where it
      // is; the board still opened without it, and the next load tries again.
      console.error('vidi6: damaged update could not be quarantined', seq, messageOf(failure));
    }
  }

  private maxLogSeq(): number {
    const rows = this.sql.exec<{ n: number | null }>('SELECT MAX(seq) AS n FROM updates').toArray();
    return rows[0]!.n ?? 0;
  }
}

/** The message of anything thrown, which is what a quarantine row records. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `storage_meta` holds text, so a saved chunk is kept as base64. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
