// Story 4, design "storage layout": the board store on top of the Durable
// Object SQLite API.
//
// Tables (schema version 1, design decision 2):
//   storage_meta          TEXT key/value (schema version, snapshot_through_seq)
//   updates               update log: AUTOINCREMENT seq, BLOB data, INTEGER bytes
//   snapshot_chunks       compacted snapshot: sequential BLOB chunks
//   quarantined_updates   rows the loader could not apply (seq, data, error, ts)
//
// Durability (design decision 4): every applied update is INSERTed as one
// updates row before the room broadcasts it (the Durable Object holds
// outbound WebSocket messages until pending writes commit), and the log is
// compacted into the snapshot tables when it grows past the configured
// thresholds. Compaction runs inside ONE transaction; any failure rolls the
// whole transaction back and leaves the previous snapshot + log untouched.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Storage origin for updates applied while loading from the store: the room
 * recognises it and neither re-stores nor re-broadcasts them (design,
 * "storage and y-protocols integration", step 2).
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load-origin');

/**
 * The subset of the Durable Object storage API the store actually uses. The
 * structural shape (instead of `DurableObjectStorage`) lets the pure helpers
 * run in unit tests and the class run in the workerd pool unchanged.
 */
export interface BoardStoreStorage {
  sql: {
    exec(query: string, ...bindings: unknown[]): SqlCursor;
  };
  /**
   * Durable Object transaction (lives on the DO state, not on the SQL API):
   * all statements inside `work` commit or roll back together.
   */
  transactionSync<T>(work: () => T): T;
}

interface SqlCursor {
  toArray(): unknown[];
  one(): unknown;
}

/** The result of loading snapshot + log into a doc (design "load()"). */
export interface LoadResult {
  ok: boolean;
  quarantined: number;
  reason?: string;
  error?: string;
}

/** Test-only fault stages the store can be made to fail at. */
export type BoardStoreFault =
  | 'append'
  | 'compaction-after-chunk-delete'
  | 'load-select';

// ---------------------------------------------------------------------------
// Chunking helpers (TC-01, TC-02).
//
// The snapshot is a single Yjs update split at fixed byte offsets. Yjs
// updates are self-delimiting, so the JOIN of the chunks is byte-identical
// to the original update and applies to a fresh doc.
// ---------------------------------------------------------------------------

/** Split an update into chunks of at most `size` bytes (empty -> no chunks). */
export function chunkUpdate(update: Uint8Array, size: number): Uint8Array[] {
  if (size <= 0) {
    throw new Error('chunk size must be positive');
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < update.byteLength; offset += size) {
    chunks.push(update.slice(offset, offset + size));
  }
  return chunks;
}

/** Concatenate chunks back into one byte array (inverse of chunkUpdate). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Story 4: compaction threshold check (TC-17: exactly at the threshold). */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toUint8Array(value: unknown, what: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(`unexpected ${what} from storage: ${typeof value}`);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.byteLength; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export class BoardStore {
  private readonly sql: BoardStoreStorage['sql'];
  private readonly storage: BoardStoreStorage;
  private tracked = false;
  /** True once migrate() has run on this wrapper (story 5: lazy migration). */
  private migrated = false;
  private rowBytes = 0;
  private rowCount = 0;
  private maxSeq = 0;
  private throughSeq = 0;
  private fault: BoardStoreFault | null = null;

  constructor(storage: BoardStoreStorage) {
    this.sql = storage.sql;
    this.storage = storage;
  }

  /** DO transaction with the correct native `this` (see BoardStoreStorage). */
  private txn<T>(work: () => T): T {
    return this.storage.transactionSync(work);
  }

  /**
   * Create/upgrade the schema and record the version. Idempotent; writes no
   * board data (TC-25: a migrated board has empty updates/snapshot tables).
   *
   * Story 5: no longer run on construction — the schema is created either by
   * `BoardRoom.initialize()` (a real board) or lazily by the first append.
   */
  migrate(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (' +
        'key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (' +
        'seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (' +
        'idx INTEGER PRIMARY KEY, data BLOB NOT NULL)'
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
        'seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT, quarantined_at INTEGER NOT NULL)'
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)",
      String(STORAGE_SCHEMA_VERSION)
    );
    this.migrated = true;
  }

  /** Run migrate() at most once on this wrapper (lazy, story 5). */
  private migrateIfNeeded(): void {
    if (!this.migrated) {
      this.migrate();
    }
  }

  /**
   * READ-ONLY existence check (share.board_api): the board exists when it has
   * a created_at, OR legacy data (at least one updates or snapshot_chunks
   * row). Queries sqlite_master first, so this NEVER creates tables — an
   * unknown board stays table-less until initialize() runs.
   */
  existsReadOnly(): boolean {
    const tables = new Set(this.tableNames());
    if (tables.has('storage_meta')) {
      for (const row of this.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
        .toArray()) {
        if ((row as { value: string }).value !== '') {
          return true;
        }
      }
    }
    if (tables.has('updates') || tables.has('snapshot_chunks')) {
      const updates = this.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray();
      if (((updates[0] as { c: number } | undefined)?.c ?? 0) > 0) {
        return true;
      }
      const chunks = this.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray();
      if (((chunks[0] as { c: number } | undefined)?.c ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  /** The board's creation timestamp (ms), or null (share.board_api). */
  getCreatedAt(): number | null {
    if (!this.tableNames().includes('storage_meta')) {
      return null;
    }
    for (const row of this.sql
      .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
      .toArray()) {
      const value = (row as { value: string }).value;
      if (value !== '') {
        return Number(value);
      }
    }
    return null;
  }

  /** Record the creation timestamp (write-once by initialize(); share.legacy_boards). */
  setCreatedAt(ts: number): void {
    this.sql.exec(
      "INSERT INTO storage_meta (key, value) VALUES ('created_at', ?) " +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      String(ts),
    );
  }

  /** Table names present in this storage (sqlite_master; creates nothing). */
  tableNames(): string[] {
    return this.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => (row as { name: string }).name);
  }

  /**
   * Append one applied update to the log. The row is durably written before
   * this call returns (synchronous SQLite inside the Durable Object).
   */
  append(update: Uint8Array): void {
    // Story 5: the first write creates the schema (lazy migration) — a board
    // seeded only via legacy storage gets the missing tables on first use.
    this.migrateIfNeeded();
    this.ensureTracked();
    this.checkFault('append');
    this.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update,
      update.byteLength
    );
    this.maxSeq += 1;
    this.rowCount += 1;
    this.rowBytes += update.byteLength;
  }

  /**
   * Load snapshot + log into `doc` (design "load()").
   *
   * Order: snapshot chunks first (joined), then log rows with seq >
   * snapshot_through_seq in seq order. A row Yjs cannot apply is QUARANTINED
   * (moved to quarantined_updates, console.error) and loading continues; a
   * snapshot that cannot be applied at all fails the load (the log cannot
   * be trusted on top of a half-read snapshot).
   */
  load(doc: Y.Doc): LoadResult {
    try {
      this.ensureTracked();
      this.checkFault('load-select');

      // Story 5: tables may be missing (unknown board) or partial (legacy
      // board with only an updates table); read each table only when present.
      const tables = new Set(this.tableNames());
      if (tables.has('snapshot_chunks')) {
        const chunkRows = this.sql
          .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
          .toArray();
        if (chunkRows.length > 0) {
          const snapshot = joinChunks(
            chunkRows.map((row) =>
              toUint8Array((row as { data: unknown }).data, 'snapshot chunk')
            )
          );
          try {
            Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
          } catch (error) {
            console.error({ kind: 'snapshot-unreadable', error: String(error) });
            return { ok: false, quarantined: 0, reason: 'snapshot-unreadable', error: String(error) };
          }
        }
      }

      const rows = tables.has('updates')
        ? this.sql
            .exec('SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq', this.throughSeq)
            .toArray()
        : [];
      let quarantined = 0;
      let rowCount = 0;
      let rowBytes = 0;
      let maxSeq = this.throughSeq;
      for (const raw of rows) {
        const row = raw as { seq: number; data: unknown; bytes: number };
        const data = toUint8Array(row.data, 'update row');
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (error) {
          this.quarantine(row.seq, data, error);
          quarantined += 1;
          continue;
        }
        rowCount += 1;
        rowBytes += row.bytes;
        if (row.seq > maxSeq) {
          maxSeq = row.seq;
        }
      }
      this.rowCount = rowCount;
      this.rowBytes = rowBytes;
      this.maxSeq = maxSeq;
      return { ok: true, quarantined };
    } catch (error) {
      console.error({ kind: 'board-load-sql-error', error: String(error) });
      return { ok: false, quarantined: 0, reason: 'sql-error', error: String(error) };
    }
  }

  /**
   * Compact the log into the snapshot when the thresholds are exceeded
   * (design decision 4). One transaction: delete old chunks, insert new
   * chunks, delete log rows <= maxSeq, bump snapshot_through_seq. Any
   * failure rolls the whole transaction back (previous snapshot + log are
   * untouched) and returns false.
   *
   * @param doc the room's in-memory doc (snapshot = encodeStateAsUpdate(doc))
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    this.ensureTracked();
    if (!shouldCompact(this.rowCount, this.rowBytes)) {
      return false;
    }
    return this.compact(doc);
  }

  /**
   * Run the compaction transaction for the state of the given doc. Any
   * failure rolls the whole transaction back (previous snapshot + log are
   * untouched) and returns false — a compaction error never propagates
   * (design: "Compacting --> Ready: compaction error rolled back, log
   * intact").
   *
   * @param doc the doc whose full state becomes the new snapshot
   */
  compact(doc: Y.Doc): boolean {
    this.migrateIfNeeded();
    this.ensureTracked();
    const chunks = chunkUpdate(Y.encodeStateAsUpdate(doc), SNAPSHOT_CHUNK_BYTES);
    try {
      this.txn<void>(() => {
        this.sql.exec('DELETE FROM snapshot_chunks');
        this.checkFault('compaction-after-chunk-delete');
        chunks.forEach((chunk, idx) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', this.maxSeq);
        this.sql.exec(
          "INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?) " +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          String(this.maxSeq)
        );
      });
    } catch (error) {
      console.error({ kind: 'compaction-rolled-back', error: String(error) });
      return false;
    }
    this.rowCount = 0;
    this.rowBytes = 0;
    this.throughSeq = this.maxSeq;
    // maxSeq is intentionally unchanged: the AUTOINCREMENT sequence keeps
    // counting past it, so appends never reuse a seq.
    return true;
  }

  /** Log statistics for threshold checks and tests. */
  get stats(): { count: number; bytes: number; maxSeq: number; throughSeq: number } {
    this.ensureTracked();
    return {
      count: this.rowCount,
      bytes: this.rowBytes,
      maxSeq: this.maxSeq,
      throughSeq: this.throughSeq,
    };
  }

  // -------------------------------------------------------------------------
  // Test-only surface (used by the integration tests and the TEST_HOOKS e2e
  // routes). Never called from the product path.
  // -------------------------------------------------------------------------

  /** Make the next operation at `stage` throw once (TC-11, TC-14, TC-26). */
  testInjectFault(stage: BoardStoreFault): void {
    this.fault = stage;
  }

  /** Compact regardless of the thresholds (e2e "compact" hook). */
  testForceCompact(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  /**
   * Corrupt snapshot chunk 0 for the broken-board e2e (TC-24): the original
   * bytes are backed up in storage_meta so /repair can restore them.
   */
  testCorruptSnapshotChunk0(): { ok: boolean; reason?: string } {
    this.ensureTracked();
    const rows = this.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
    if (rows.length === 0) {
      return { ok: false, reason: 'no-snapshot-chunk' };
    }
    const original = toUint8Array((rows[0] as { data: unknown }).data, 'snapshot chunk');
    this.sql.exec(
      "INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('test_backup_chunk0', ?)",
      toHex(original)
    );
    const garbage = new Uint8Array(original.byteLength);
    for (let i = 0; i < garbage.byteLength; i++) {
      garbage[i] = (i * 31 + 7) & 0xff;
    }
    this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage);
    return { ok: true };
  }

  /** Restore snapshot chunk 0 from the backup written by testCorruptSnapshotChunk0. */
  testRepairSnapshotChunk0(): { ok: boolean; reason?: string } {
    const rows = this.sql
      .exec("SELECT value FROM storage_meta WHERE key = 'test_backup_chunk0'")
      .toArray();
    if (rows.length === 0) {
      return { ok: false, reason: 'no-backup' };
    }
    const original = fromHex((rows[0] as { value: string }).value);
    this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
    this.sql.exec("DELETE FROM storage_meta WHERE key = 'test_backup_chunk0'");
    return { ok: true };
  }

  /** Overwrite one updates row with damaged bytes (TC-09, TC-14). */
  testCorruptUpdateRow(seq: number, mode: 'random' | 'truncate'): { ok: boolean; reason?: string } {
    const rows = this.sql.exec('SELECT data FROM updates WHERE seq = ?', seq).toArray();
    if (rows.length === 0) {
      return { ok: false, reason: 'no-such-row' };
    }
    const original = toUint8Array((rows[0] as { data: unknown }).data, 'update row');
    let damaged: Uint8Array;
    if (mode === 'truncate') {
      const cut = Math.min(10, original.byteLength);
      damaged = original.slice(0, original.byteLength - cut);
    } else {
      damaged = new Uint8Array(original.byteLength);
      for (let i = 0; i < damaged.byteLength; i++) {
        damaged[i] = (i * 17 + original[i]) & 0xff;
      }
    }
    this.sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged, seq);
    return { ok: true };
  }

  /** Inspect the storage tables (integration tests; not exposed over HTTP). */
  testInspectStorage(): {
    meta: Record<string, string>;
    updatesRows: { seq: number; bytes: number }[];
    snapshotChunkCount: number;
    quarantined: { seq: number; error: string | null }[];
  } {
    this.ensureTracked();
    // Story 5: safe on unknown boards (no tables) and legacy boards (partial
    // schema): each table is read only when present.
    const tables = new Set(this.tableNames());
    const meta: Record<string, string> = {};
    if (tables.has('storage_meta')) {
      for (const row of this.sql.exec('SELECT key, value FROM storage_meta').toArray()) {
        const r = row as { key: string; value: string };
        meta[r.key] = r.value;
      }
    }
    const updatesRows = tables.has('updates')
      ? (this.sql.exec('SELECT seq, bytes FROM updates ORDER BY seq').toArray() ?? []).map((row) => {
          const r = row as { seq: number; bytes: number };
          return { seq: r.seq, bytes: r.bytes };
        })
      : [];
    const chunks = tables.has('snapshot_chunks')
      ? this.sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').toArray()
      : [];
    const quarantined = tables.has('quarantined_updates')
      ? (this.sql.exec('SELECT seq, error FROM quarantined_updates ORDER BY seq').toArray() ?? []).map((row) => {
          const r = row as { seq: number; error: string | null };
          return { seq: r.seq, error: r.error };
        })
      : [];
    return {
      meta,
      updatesRows,
      snapshotChunkCount: (chunks[0] as { c: number } | undefined)?.c ?? 0,
      quarantined,
    };
  }

  // -------------------------------------------------------------------------

  private checkFault(stage: BoardStoreFault): void {
    if (this.fault === stage) {
      this.fault = null;
      throw new Error(`injected fault at ${stage}`);
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: unknown): void {
    this.txn<void>(() => {
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        String(error),
        Date.now()
      );
    });
    console.error({ kind: 'update-quarantined', seq, error: String(error) });
  }

  /**
   * (Re)initialise the in-memory tracking (row count/bytes, max seq,
   * snapshot_through_seq) from the database. Called lazily on first write or
   * read; load() overwrites it with the exact values it observed.
   */
  private ensureTracked(): void {
    if (this.tracked) {
      return;
    }
    // Story 5: tables may be missing (unknown board); track zeros instead.
    const tables = new Set(this.tableNames());
    let through = 0;
    if (tables.has('storage_meta')) {
      for (const row of this.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
        .toArray()) {
        through = parseInt((row as { value: string }).value, 10);
      }
    }
    const agg = (tables.has('updates')
      ? (this.sql
          .exec(
            'SELECT COALESCE(MAX(seq), 0) AS m, COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM updates'
          )
          .toArray()[0] ?? { m: 0, c: 0, b: 0 })
      : { m: 0, c: 0, b: 0 }) as { m: number; c: number; b: number };
    this.throughSeq = through;
    this.maxSeq = Math.max(agg.m, through);
    this.rowCount = agg.c;
    this.rowBytes = agg.b;
    this.tracked = true;
  }
}
