// Durable Object harness for the storage tests (tests/workers pool).
//
// The point of this file is to exercise src/worker/board-store.ts against REAL
// SQLite-backed Durable Object storage — the same `ctx.storage.sql` the room
// uses — without dragging sockets and Yjs providers into a storage test. The
// room itself is exercised over real sockets in tests/integration.
//
// Everything here runs INSIDE the object (via `runInDurableObject`), so SQL
// behaviour, transaction rollback and blob representation are the production
// ones. `failStatement` is the injected-failure seam: it throws OUTSIDE SQLite,
// between statements, which is what makes the rollback test (TC-11) a real
// rollback rather than a mocked one.

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { BoardStore, LOAD_ORIGIN } from '../../src/worker/board-store';
import { snapshot } from '../../src/shared/board-model';

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  throw new Error(`unexpected blob value: ${typeof value}`);
}

export class StoreHarness extends DurableObject {
  private store: BoardStore;

  /** SQL prefixes that throw instead of running (armed per test). */
  private failPrefixes: string[] = [];

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const storage = ctx.storage as unknown as {
      sql: { exec(query: string, ...bindings: unknown[]): Iterable<Record<string, unknown>> };
      transactionSync<T>(closure: () => T): T;
    };
    this.store = new BoardStore(storage, {
      failStatement: (query: string) => this.failPrefixes.some((prefix) => query.startsWith(prefix)),
    });
  }

  private sql(query: string, ...bindings: unknown[]): Record<string, unknown>[] {
    return [...this.ctx.storage.sql.exec(query, ...bindings)];
  }

  /** A document holding the given updates (the "current" board state). */
  private docFrom(updates: Uint8Array[]): Y.Doc {
    const doc = new Y.Doc({ gc: true });
    for (const update of updates) Y.applyUpdate(doc, update, LOAD_ORIGIN);
    return doc;
  }

  /** Migrate + load into a fresh document: the "empty board" probe. */
  async open(): Promise<Record<string, unknown>> {
    this.store.migrate();
    const fresh = new Y.Doc({ gc: true });
    const result = this.store.load(fresh);
    return {
      result,
      version: this.sql(`SELECT value FROM storage_meta WHERE key = ?`, 'storage_schema_version')[0]?.['value'] ?? null,
      snapshot: snapshot(fresh),
      tables: this.sql(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).map((row) => row['name']),
      log: this.store.dumpLog(),
      chunks: this.store.dumpSnapshot(),
    };
  }

  /** Append each update as its own log row, then report what SQLite holds. */
  async appendMany(updates: Uint8Array[]): Promise<Record<string, unknown>> {
    for (const update of updates) this.store.append(update);
    return { log: this.store.dumpLog(), stats: this.store.stats };
  }

  /** Load the stored state into a NEW document (what a wake-time load does). */
  async loadFresh(): Promise<Record<string, unknown>> {
    const fresh = new Y.Doc({ gc: true });
    const result = this.store.load(fresh);
    return { result, snapshot: snapshot(fresh), quarantine: this.store.dumpQuarantined() };
  }

  /** Force the compaction rewrite (ignores the thresholds) over `updates`. */
  async compact(updates: Uint8Array[]): Promise<Record<string, unknown>> {
    const doc = this.docFrom(updates);
    const ok = this.store.forceCompact(doc);
    return { ok, log: this.store.dumpLog(), chunks: this.store.dumpSnapshot(), stats: this.store.stats };
  }

  /** Damage the stored log row `seq` with new bytes (a real row rewrite). */
  async damageLogRow(seq: number, bytes: Uint8Array): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE updates SET data = ?, bytes = ? WHERE seq = ?`,
      bytes.slice(),
      bytes.byteLength,
      seq,
    );
  }

  /** Damage snapshot chunk `idx` (same length, garbage content). */
  async damageSnapshotChunk(idx: number): Promise<void> {
    const rows = this.sql(`SELECT data FROM snapshot_chunks WHERE idx = ?`, idx);
    if (rows.length === 0) return;
    const original = bytesOf(rows[0]['data']);
    const damaged = new Uint8Array(original.length);
    for (let i = 0; i < damaged.length; i += 1) damaged[i] = (original[i] + 163) % 256;
    this.ctx.storage.sql.exec(`UPDATE snapshot_chunks SET data = ? WHERE idx = ?`, damaged.buffer, idx);
  }

  /** Arm a SQL failure for statements starting with `prefix`. */
  async armFailure(prefix: string): Promise<void> {
    this.failPrefixes.push(prefix);
  }

  async storeState(): Promise<Record<string, unknown>> {
    return { log: this.store.dumpLog(), chunks: this.store.dumpSnapshot(), stats: this.store.stats };
  }
}
