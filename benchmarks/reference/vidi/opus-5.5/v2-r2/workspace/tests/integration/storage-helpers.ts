// Direct access to a board room's real SQLite storage for persistence tests.
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { type StickySnapshot, snapshot } from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import { BoardStore, type LoadResult } from '../../src/worker/board-store';

export function roomStub(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

export function inRoom<R>(boardId: string, fn: (room: BoardRoom, storage: DurableObjectStorage) => R | Promise<R>): Promise<R> {
  return runInDurableObject(roomStub(boardId), (room, state) => fn(room, state.storage));
}

export function count(storage: DurableObjectStorage, table: string): number {
  return storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
}

/** Loads the board from storage into a fresh doc, as a woken room would. */
export function loadFromStorage(storage: DurableObjectStorage): { result: LoadResult; notes: readonly StickySnapshot[] } {
  const doc = new Y.Doc();
  const result = new BoardStore(storage).load(doc);
  return { result, notes: snapshot(doc) };
}

/** Wraps real storage so that SQL statements matching `pattern` throw. */
export function failingStorage(storage: DurableObjectStorage, pattern: RegExp): DurableObjectStorage {
  const sql = {
    exec(query: string, ...bindings: unknown[]) {
      if (pattern.test(query)) throw new Error(`injected SQL failure: ${query.slice(0, 40)}`);
      return storage.sql.exec(query, ...bindings);
    },
  };
  return {
    sql,
    transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
  } as unknown as DurableObjectStorage;
}
