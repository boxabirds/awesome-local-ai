// Integration helpers for exercising `BoardStore` against the real SQLite storage
// of a real Durable Object. Each call runs inside a fresh board's object (a fresh
// database, isolated from every other board), borrows that object's
// `DurableObjectStorage`, and builds its OWN `BoardStore` on it — so the storage
// engine is the real thing while the store under test is independent of the room's
// internal one. Return values are made serialisable inside the object and asserted
// outside, where the fixtures and matchers live.

import { runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { BoardStore } from '../../../src/worker/board-store';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import { bindings } from './room';

/** Everything the test can learn about the storage after running an action. */
export interface StoreProbe {
  counts: {
    updates: number;
    snapshot_chunks: number;
    quarantined_updates: number;
  };
  /** `snapshot_through_seq` from storage_meta, or null when absent. */
  snapshotThroughSeq: string | null;
  /** `storage_schema_version` from storage_meta. */
  storageSchemaVersion: string | null;
  /** The `bytes` column of every update row, in seq order. */
  updateBytes: number[];
}

/** Run `body` against a fresh board's BoardStore and return a serialisable result. */
export async function runStore<T>(
  body: (args: {
    store: BoardStore;
    storage: DurableObjectStorage;
    newDoc: () => Y.Doc;
    loadInto: () => { doc: Y.Doc; notes: () => readonly StickySnapshot[] };
    probe: () => StoreProbe;
    /** The byte length of each snapshot chunk, in idx order. */
    chunkSizes: () => number[];
  }) => T | Promise<T>,
  boardId: string = newBoardId(),
): Promise<{ boardId: string; result: T }> {
  const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
  const result = await runInDurableObject(stub, (_instance, state) => {
    const store = new BoardStore(state.storage);
    const storage = state.storage;
    const newDoc = () => new Y.Doc();
    const loadInto = () => {
      const doc = new Y.Doc();
      return { doc, notes: () => snapshot(doc) };
    };
    const probe = (): StoreProbe => {
      const sql = storage.sql;
      const one = (q: string, ...b: unknown[]): number => {
        const rows = sql.exec(q, ...b).toArray();
        return rows.length > 0 ? Number(Object.values(rows[0]!)[0]) : 0;
      };
      const meta = (key: string): string | null => {
        const rows = sql
          .exec('SELECT value FROM storage_meta WHERE key = ?', key)
          .toArray();
        return rows.length > 0 ? String(rows[0]!.value) : null;
      };
      return {
        counts: {
          updates: one('SELECT COUNT(*) FROM updates'),
          snapshot_chunks: one('SELECT COUNT(*) FROM snapshot_chunks'),
          quarantined_updates: one('SELECT COUNT(*) FROM quarantined_updates'),
        },
        snapshotThroughSeq: meta('snapshot_through_seq'),
        storageSchemaVersion: meta('storage_schema_version'),
        updateBytes: sql
          .exec('SELECT bytes FROM updates ORDER BY seq')
          .toArray()
          .map((row) => Number(row.bytes)),
      };
    };
    const chunkSizes = (): number[] =>
      storage.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray()
        .map((row) => (row.data as ArrayBuffer).byteLength);
    return body({ store, storage, newDoc, loadInto, probe, chunkSizes });
  });
  return { boardId, result };
}

/** A probe of the raw tables, run against a board id from the outside. */
export async function probeBoard(boardId: string): Promise<StoreProbe> {
  return runStore(({ probe }) => probe(), boardId).then((r) => r.result);
}
