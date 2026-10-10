import * as Y from 'yjs';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { createEncoder, toUint8Array, writeUint8, writeVarUint } from 'lib0/encoding';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION
} from '../shared/config';

// A quarantined row can leave a hole in the client clock; later updates from
// that client would otherwise sit in `store.pendingStructs` forever. Gaps are
// closed with GC structs up to this length; anything larger is treated as a
// corrupt header and skipped.
const MAX_GAP_FILL = 10_000_000;

// Origin tag for updates applied while loading from storage: the BoardRoom's
// update handler must not store or broadcast them (they are already stored).
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

// Splits data into chunks of at most `size` bytes (TC-01 boundaries: 0 → 0
// chunks, exactly size → 1 chunk, size + 1 → 2 chunks).
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size < 1) throw new RangeError('chunk size must be >= 1');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';
const META_TEST_CHUNK0 = 'test_chunk0_original';
// Story 5: written once when a board is deliberately created. Its presence
// (or any legacy row in updates/snapshot_chunks) is what makes a board
// "exist"; probing an unknown link must never write it (share.not_found).
export const META_CREATED_AT = 'created_at';

function firstRow<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>
): T | undefined {
  const result = cursor.next();
  return result.done ? undefined : result.value;
}

function toBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

// V1 update layout: [numClients] followed by, per client,
// [numStructs][client][startClock][structs...], then the delete set. Reads
// only the per-client headers; the first struct of a client starts at
// `startClock`, i.e. the clock the writer expected us to have.
function firstStructClocks(update: Uint8Array): Array<[number, number]> {
  const decoder = createDecoder(update);
  const result: Array<[number, number]> = [];
  const numClients = readVarUint(decoder);
  if (numClients > 1000) return result;
  for (let i = 0; i < numClients; i += 1) {
    readVarUint(decoder); // numStructs: clocks advance by struct lengths, unused here
    const client = readVarUint(decoder);
    const startClock = readVarUint(decoder);
    result.push([client, startClock]);
  }
  return result;
}

// Hand-built Yjs update containing only GC structs (info byte 0): reserves a
// clock range without content so updates that depend on a quarantined row
// integrate instead of being deferred indefinitely.
function gapFillUpdate(fills: Array<[number, number, number]>): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, fills.length);
  for (const [client, start, len] of fills) {
    writeVarUint(encoder, 1);
    writeVarUint(encoder, client);
    writeVarUint(encoder, start);
    writeUint8(encoder, 0); // GC
    writeVarUint(encoder, len);
  }
  writeVarUint(encoder, 0); // empty delete set
  return toUint8Array(encoder);
}

// Closes clock holes that block `update`: for every client whose structs in
// `update` start past our stored clock, insert GC over the missing range.
// Safe on intact streams (start === stored clock → no fills). The recovered
// board loses only the quarantined change itself, per persist.partial_damage.
function fillClockGaps(doc: Y.Doc, update: Uint8Array): number {
  try {
    const stored = Y.decodeStateVector(Y.encodeStateVector(doc));
    const fills: Array<[number, number, number]> = [];
    for (const [client, startClock] of firstStructClocks(update)) {
      const from = stored.get(client) ?? 0;
      if (startClock > from && startClock - from < MAX_GAP_FILL) {
        fills.push([client, from, startClock - from]);
      }
    }
    if (fills.length === 0) return 0;
    Y.applyUpdate(doc, gapFillUpdate(fills), LOAD_ORIGIN);
    return fills.length;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'gap-fill-failed',
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return 0;
  }
}

// SQL storage for one board: a snapshot (chunked so no row exceeds the
// platform per-row BLOB limit), an append-only update log and a quarantine
// table for log rows that fail to apply. All methods are synchronous; the
// Durable Object output gate holds broadcasts until writes are durable.
export class BoardStore {
  private readonly storage: DurableObjectStorage;
  readonly sql: SqlStorage;
  // Tracked in memory after load to avoid a COUNT(*) per write.
  private logCount = 0;
  private logBytes = 0;
  // Story 5: migrate() no longer runs on construct. This flag records whether
  // the schema is known to exist (set by migrate(), or by load() observing
  // the tables) so append() can create it lazily exactly once.
  private tablesReady = false;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  // True when the given table exists, without creating anything.
  private hasTable(name: string): boolean {
    const row = firstRow(
      this.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        name
      )
    );
    return row !== undefined;
  }

  // Story 5 (share.not_found): a board exists when storage_meta.created_at is
  // set, or (legacy boards, share.legacy_boards) when it has at least one row
  // in updates or snapshot_chunks. Purely read-only: for an unknown id nothing
  // exists and nothing is written, so probing links leaves no storage behind.
  existsReadOnly(): boolean {
    if (!this.hasTable('storage_meta')) return false;
    const created = firstRow(
      this.sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_CREATED_AT
      )
    );
    if (created !== undefined) return true;
    if (this.hasTable('updates')) {
      const row = firstRow(
        this.sql.exec<{ one: number }>('SELECT 1 AS one FROM updates LIMIT 1')
      );
      if (row !== undefined) return true;
    }
    if (this.hasTable('snapshot_chunks')) {
      const row = firstRow(
        this.sql.exec<{ one: number }>('SELECT 1 AS one FROM snapshot_chunks LIMIT 1')
      );
      if (row !== undefined) return true;
    }
    return false;
  }

  // Records creation (created_at = epoch ms) exactly once. Returns false when
  // the board was already initialised, so createBoard can tell 'created' from
  // 'exists' (TC-15: an existing board is never re-initialised).
  markCreated(): boolean {
    this.migrate();
    if (
      firstRow(
        this.sql.exec<{ value: string }>(
          'SELECT value FROM storage_meta WHERE key = ?',
          META_CREATED_AT
        )
      ) !== undefined
    ) {
      return false;
    }
    this.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
      META_CREATED_AT,
      String(Date.now())
    );
    return true;
  }

  migrate(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)'
    );
    const row = firstRow(
      this.sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_SCHEMA_VERSION
      )
    );
    if (row === undefined) {
      this.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION)
      );
    }
    this.tablesReady = true;
  }

  // Inserts one update; SQL errors are rethrown (the room resets itself).
  // Story 5: the schema is created lazily on first write (migrate no longer
  // runs on construct, so existence probes of unknown boards never write).
  append(update: Uint8Array): void {
    if (!this.tablesReady) this.migrate();
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  // Applies snapshot + log to a fresh doc. Damaged log rows are quarantined
  // and the rest still load (persist.partial_damage). A damaged snapshot or a
  // SQL error returns ok:false — never an empty board (persist.load_failure).
  // Story 5: a board whose tables do not exist yet is an empty board; the
  // load reads nothing and creates nothing (existence is checked separately).
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.hasTable('updates')) {
        this.logCount = 0;
        this.logBytes = 0;
        return { ok: true, quarantined: 0 };
      }
      this.tablesReady = true;

      const chunkRows = this.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((row) => toBytes(row.data)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }

      const throughRow = firstRow(
        this.sql.exec<{ value: string }>(
          'SELECT value FROM storage_meta WHERE key = ?',
          META_SNAPSHOT_THROUGH
        )
      );
      const throughSeq = throughRow !== undefined ? Number(throughRow.value) : 0;

      const logRows = this.sql
        .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
          'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
          throughSeq
        )
        .toArray();

      let quarantined = 0;
      let applied = 0;
      let bytes = 0;
      for (const row of logRows) {
        const update = toBytes(row.data);
        fillClockGaps(doc, update);
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
          applied += 1;
          bytes += row.bytes;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.quarantine(row.seq, update, message);
          quarantined += 1;
        }
      }
      this.logCount = applied;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (error) {
      return {
        ok: false,
        reason: 'sql-error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private quarantine(seq: number, data: Uint8Array, message: string): void {
    try {
      this.storage.transactionSync(() => {
        this.sql.exec(
          'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data,
          message,
          Date.now()
        );
        this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      });
    } catch (error) {
      // A quarantine write must not lose the board; report and carry on.
      console.error(
        JSON.stringify({
          event: 'quarantine-write-failed',
          seq,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
    console.error(JSON.stringify({ event: 'update-quarantined', seq, error: message }));
  }

  // Compacts the log into a fresh chunked snapshot inside one transaction;
  // any failure rolls back (previous snapshot and log intact). Never throws.
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  // One compaction pass, bypassing the threshold check (compactIfNeeded
  // delegates here; the test hook forces a snapshot for small boards).
  compact(doc: Y.Doc): boolean {
    try {
      const maxRow = firstRow(
        this.sql.exec<{ max_seq: number | null }>('SELECT MAX(seq) AS max_seq FROM updates')
      );
      const maxSeq = maxRow?.max_seq ?? null;
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
        });
        if (maxSeq !== null) {
          this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }
        this.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          META_SNAPSHOT_THROUGH,
          String(maxSeq ?? 0)
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          error: error instanceof Error ? error.message : String(error)
        })
      );
      // Re-read the counters so a rolled-back compaction retries fairly.
      this.refreshLogStats();
      return false;
    }
  }

  private refreshLogStats(): void {
    try {
      const row = firstRow(
        this.sql.exec<{ count: number; total: number }>(
          'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS total FROM updates'
        )
      );
      this.logCount = row?.count ?? 0;
      this.logBytes = row?.total ?? 0;
    } catch {
      // Stats stay as-is; the next load recomputes them.
    }
  }

  // ---- test-only helpers (TEST_HOOKS corrupt/repair; integration tests) ----

  // Legacy-board seeding (share.legacy_boards tests): insert real update rows
  // directly, deliberately WITHOUT created_at, mimicking storage written
  // before board creation existed.
  debugSeedUpdates(updates: Uint8Array[]): void {
    this.migrate();
    for (const update of updates) {
      this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    }
  }

  debugCreatedAt(): string | undefined {
    const row = firstRow(
      this.sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_CREATED_AT
      )
    );
    return row?.value;
  }

  debugSnapshotChunkCount(): number {
    const row = firstRow(
      this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM snapshot_chunks')
    );
    return row?.count ?? 0;
  }

  debugRowCount(): { updates: number; chunks: number } {
    const updates = firstRow(
      this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM updates')
    );
    return { updates: updates?.count ?? 0, chunks: this.debugSnapshotChunkCount() };
  }

  // Overwrites snapshot chunk 0 with random bytes of the same length, saving
  // the original in storage_meta so debugRepairChunk0 can restore it.
  debugCorruptChunk0(): void {
    const row = firstRow(
      this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
    );
    if (row === undefined) throw new Error('no snapshot chunk 0 to corrupt');
    const original = toBytes(row.data);
    this.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      META_TEST_CHUNK0,
      bytesToBase64(original)
    );
    const garbage = new Uint8Array(original.length);
    crypto.getRandomValues(garbage);
    this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);
  }

  debugRepairChunk0(): void {
    const row = firstRow(
      this.sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        META_TEST_CHUNK0
      )
    );
    if (row === undefined) return;
    const original = base64ToBytes(row.value);
    this.storage.transactionSync(() => {
      this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
      this.sql.exec('DELETE FROM storage_meta WHERE key = ?', META_TEST_CHUNK0);
    });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
