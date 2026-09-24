/**
 * Helpers for tests that look inside a board's Durable Object storage. Every board id is a
 * separate object with its own SQLite database, so tests isolate themselves by using a new id.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import type { BoardRoom } from '../../src/worker/board-room';
import { BoardStore, META_SNAPSHOT_THROUGH_SEQ } from '../../src/worker/board-store';

export type Table = 'updates' | 'snapshot_chunks' | 'quarantined_updates' | 'storage_meta';

export function roomStub(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Runs `fn` inside the board's Durable Object with its real storage. */
export function inRoom<T>(
  boardId: string,
  fn: (storage: DurableObjectStorage, room: BoardRoom, state: DurableObjectState) => T | Promise<T>,
): Promise<T> {
  return runInDurableObject(roomStub(boardId), (room: BoardRoom, state) => fn(state.storage, room, state));
}

/** Discards the object's instance (memory lost, storage kept); the next request constructs a new one. */
export async function restartRoom(boardId: string): Promise<void> {
  await runInDurableObject(roomStub(boardId), (_room, state) => {
    try {
      state.abort('restart');
    } catch {
      // abort() throws in the calling context by design.
    }
  }).catch(() => undefined);
}

export function count(storage: DurableObjectStorage, table: Table): number {
  return Number(storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n);
}

export function tableNames(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((r) => String(r.name));
}

export function meta(storage: DurableObjectStorage, key: string): string | undefined {
  const row = storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0];
  return row === undefined ? undefined : String(row.value);
}

export function throughSeq(storage: DurableObjectStorage): number {
  return Number(meta(storage, META_SNAPSHOT_THROUGH_SEQ) ?? 0);
}

/** All rows of a BLOB table as [key, bytes] pairs, for before/after comparisons. */
export function blobRows(storage: DurableObjectStorage, table: 'updates' | 'snapshot_chunks'): [number, number[]][] {
  const key = table === 'updates' ? 'seq' : 'idx';
  return storage.sql
    .exec(`SELECT ${key} AS k, data FROM ${table} ORDER BY ${key}`)
    .toArray()
    .map((r) => [Number(r.k), Array.from(new Uint8Array(r.data as ArrayBuffer))]);
}

/** Replaces the BLOB of one row with `bytes`. */
export function overwrite(
  storage: DurableObjectStorage,
  table: 'updates' | 'snapshot_chunks',
  key: number,
  bytes: Uint8Array,
): void {
  const column = table === 'updates' ? 'seq' : 'idx';
  storage.sql.exec(`UPDATE ${table} SET data = ? WHERE ${column} = ?`, bytes.slice().buffer, key);
}

/** A fresh doc loaded from this storage by a fresh store (what a woken room would see). */
export function reload(storage: DurableObjectStorage): { doc: Y.Doc; result: ReturnType<BoardStore['load']> } {
  const doc = new Y.Doc();
  const store = new BoardStore(storage);
  store.migrate();
  const result = store.load(doc);
  return { doc, result };
}

/** Writes `updates` as the board's log with a fresh store (LogOnly state). */
export function writeLog(storage: DurableObjectStorage, updates: readonly Uint8Array[]): BoardStore {
  const store = new BoardStore(storage);
  store.migrate();
  for (const u of updates) store.append(u);
  return store;
}
