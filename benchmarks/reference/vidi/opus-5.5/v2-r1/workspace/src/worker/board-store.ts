// A board's saved state in its Durable Object's SQLite database: an append-only log of Yjs
// updates, periodically compacted into a snapshot split over several rows.
//
//   storage_meta        key → value (storage_schema_version, snapshot_through_seq, created_at)
//   updates             one row per applied update, in order
//   snapshot_chunks     the snapshot (Y.encodeStateAsUpdate) in SNAPSHOT_CHUNK_BYTES pieces
//   quarantined_updates log rows that could not be read on load, kept for inspection
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Transaction origin of updates applied while loading from storage (never stored again). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Splits `data` into consecutive pieces of at most `size` bytes (none for empty input). */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!(size > 0)) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += size) chunks.push(data.subarray(at, at + size));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** True once the log has COMPACTION_UPDATE_COUNT rows or COMPACTION_BYTES bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function blob(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`expected a BLOB, got ${typeof value}`);
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

/**
 * A Yjs update holding only garbage-collected ranges: `[client, clock, length]` each. It stands
 * in for content that is gone (a quarantined log row), so later changes by the same client,
 * which Yjs otherwise keeps pending forever, can be applied.
 */
function gcRangesUpdate(ranges: [number, number, number][]): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  encoding.writeVarUint(encoder.restEncoder, ranges.length);
  for (const [client, clock, length] of ranges) {
    encoding.writeVarUint(encoder.restEncoder, 1);
    encoder.writeClient(client);
    encoding.writeVarUint(encoder.restEncoder, clock);
    new Y.GC(Y.createID(client, clock), length).write(encoder, 0);
  }
  encoding.writeVarUint(encoder.restEncoder, 0); // empty delete set
  return encoder.toUint8Array();
}

/**
 * Bridges the clock gaps left by missing updates so the changes after them apply (anything
 * built directly on the missing content is dropped, as Yjs does for deleted content).
 * Returns how many gaps were bridged.
 */
export function bridgeMissing(doc: Y.Doc, origin: unknown): number {
  let bridged = 0;
  for (;;) {
    const pending = doc.store.pendingStructs;
    if (!pending) return bridged;
    const firstPending = new Map<number, number>();
    for (const s of Y.decodeUpdateV2(pending.update).structs) {
      const { client, clock } = s.id;
      firstPending.set(client, Math.min(clock, firstPending.get(client) ?? Infinity));
    }
    const ranges: [number, number, number][] = [];
    for (const [client, clock] of firstPending) {
      const have = Y.getState(doc.store, client);
      if (clock > have) ranges.push([client, have, clock - have]);
    }
    if (!ranges.length) return bridged;
    Y.applyUpdate(doc, gcRangesUpdate(ranges), origin);
    bridged += ranges.length;
  }
}

export class BoardStore {
  /** Log rows (after the snapshot) and their total bytes, tracked after `load`/`append`. */
  private logCount = 0;
  private logBytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Creates the tables and records the storage schema version. Writes no board content. */
  migrate(): void {
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.sql.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
      String(STORAGE_SCHEMA_VERSION),
    );
    this.migrated = true;
  }

  private migrated = false;

  private hasTable(name: string): boolean {
    return (
      this.sql
        .exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, name)
        .toArray().length > 0
    );
  }

  /**
   * Whether this board exists: it was created (`created_at`), or it is a board saved before
   * boards were created explicitly (any update or snapshot row). Only reads; never creates tables.
   */
  existsReadOnly(): boolean {
    if (
      this.hasTable('storage_meta') &&
      this.sql.exec(`SELECT 1 FROM storage_meta WHERE key = 'created_at'`).toArray().length
    ) {
      return true;
    }
    for (const table of ['updates', 'snapshot_chunks']) {
      if (this.hasTable(table) && this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length) {
        return true;
      }
    }
    return false;
  }

  /** Records the board's creation time unless it has one: 'created', or 'exists' when it had. */
  initialize(now = Date.now()): 'created' | 'exists' {
    this.migrate();
    const had = this.sql.exec(`SELECT 1 FROM storage_meta WHERE key = 'created_at'`).toArray().length;
    if (had) return 'exists';
    this.sql.exec(`INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)`, String(now));
    return 'created';
  }

  /** Stores one update at the end of the log. Throws when the write fails. */
  append(update: Uint8Array): void {
    if (!this.migrated) this.migrate();
    this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  private throughSeq(): number {
    if (!this.hasTable('storage_meta')) return 0;
    const rows = this.sql
      .exec<{ value: string }>(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`)
      .toArray();
    return rows.length ? Number(rows[0].value) : 0;
  }

  /**
   * Applies the snapshot and then every later log row to `doc` (origin LOAD_ORIGIN). A log row
   * Yjs cannot read is moved to `quarantined_updates`; an unreadable snapshot or a SQL error
   * fails the load without changing storage. Missing tables (a board never written) load as
   * an empty board without being created.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.hasTable('updates') || !this.hasTable('snapshot_chunks')) {
        this.logCount = 0;
        this.logBytes = 0;
        return { ok: true, quarantined: 0 };
      }
      const chunks = this.sql
        .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((r) => blob(r.data));
      if (chunks.length) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: errorText(e) };
        }
      }

      const rows = this.sql
        .exec<{ seq: number; data: ArrayBuffer }>(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          this.throughSeq(),
        )
        .toArray();
      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of rows) {
        const data = blob(row.data);
        try {
          // Parse the whole update first so a damaged row is rejected before any of it applies.
          Y.decodeUpdate(data);
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytes += data.length;
        } catch (e) {
          this.quarantine(row.seq, data, errorText(e));
          quarantined += 1;
        }
      }
      // A quarantined row leaves a gap that would hold back that author's later changes.
      if (quarantined) bridgeMissing(doc, LOAD_ORIGIN);
      this.logCount = count;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorText(e) };
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    if (!this.migrated) this.migrate();
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    console.error(JSON.stringify({ event: 'board-store.quarantine', seq, bytes: data.length, error }));
  }

  /**
   * Replaces the snapshot with `doc`'s full state and truncates the log once the log reaches a
   * threshold (or always with `force`). Returns true when it compacted; never throws — a
   * failure rolls back, leaving the previous snapshot and log intact.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.logCount, this.logBytes)) return false;
    try {
      if (!this.migrated) this.migrate();
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const maxSeq =
          this.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates').one().m ??
          this.throughSeq();
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)`,
          String(maxSeq),
        );
      });
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'board-store.compaction-failed', error: errorText(e) }));
      return false;
    }
  }
}
